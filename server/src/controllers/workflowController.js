import mongoose from 'mongoose';
import Workflow from '../models/Workflow.js';
import { HttpError } from '../middleware/errorHandler.js';
import { findCycle } from '../engine/topologicalOrder.js';
import { scopedFilter, findInWorkspace, createInWorkspace } from '../tenancy/scoped.js';
import { can } from '../tenancy/permissions.js';
import { normalizeNodes } from '../integrations/normalizeToolConfig.js';
import { validateNodeConnections } from '../services/connectionService.js';
import { audit } from '../services/audit.js';
import { hub } from '../collab/hub.js';
import { validateNodeStructure, checkCodeAuthorship } from '../engine/validateNodes.js';
import { validateAgentTools } from '../engine/agentLoop.js';
import WorkflowVersion from '../models/WorkflowVersion.js';
import { hasUnpublishedChanges } from '../services/versionService.js';
import { cancelWaitingRunsForWorkflow } from '../services/resumeService.js';

/**
 * The webhook token is a capability to start runs (spec/13), so only roles that
 * can manage triggers ever receive it. A viewer reading the canvas must not be
 * able to lift it out of the payload and fire the workflow from outside.
 */
function presentWorkflow(workflow, req) {
  const doc = workflow.toObject ? workflow.toObject() : { ...workflow };
  if (!can(req.role, 'triggers:manage') && doc.webhook) {
    doc.webhook = { ...doc.webhook, token: null };
  }
  return doc;
}

export async function list(req, res, next) {
  try {
    // aggregate() skips Mongoose casting, so the id has to be an ObjectId here.
    const workflows = await Workflow.aggregate([
      { $match: scopedFilter(req, { workspaceId: new mongoose.Types.ObjectId(req.workspaceId) }) },
      {
        $project: {
          name: 1,
          updatedAt: 1,
          createdAt: 1,
          nodeCount: { $size: '$nodes' },
          edgeCount: { $size: '$edges' },
          // spec/30: the dashboard's "v3" badge and its unpublished-changes dot.
          publishedVersion: { $ifNull: ['$publishedVersion', null] },
          hasUnpublishedChanges: { $ifNull: ['$hasUnpublishedChanges', false] },
        },
      },
      { $sort: { updatedAt: -1 } },
    ]);
    res.json(workflows);
  } catch (err) {
    next(err);
  }
}

export async function create(req, res, next) {
  try {
    const name = req.body?.name?.trim() || 'Untitled workflow';
    const workflow = await createInWorkspace(Workflow, req, { name, nodes: [], edges: [] });
    res.status(201).json(presentWorkflow(workflow, req));
  } catch (err) {
    next(err);
  }
}

export async function getById(req, res, next) {
  try {
    const workflow = await findInWorkspace(Workflow, req.params.id, req);
    const doc = presentWorkflow(workflow, req);
    // With a live collaboration session the hub's draft is the truth, never an
    // older database copy (spec/28 §8).
    const live = hub.getDraft(workflow._id);
    if (live) Object.assign(doc, { name: live.name, nodes: live.nodes, edges: live.edges, draftSeq: live.draftSeq });
    // Fresh rather than the stored flag, which trails the draft by a debounce.
    doc.hasUnpublishedChanges = hasUnpublishedChanges(workflow);
    res.json(doc);
  } catch (err) {
    next(err);
  }
}

export async function update(req, res, next) {
  try {
    const workflow = await findInWorkspace(Workflow, req.params.id, req);
    const { name, edges } = req.body;
    // An old client or script may still send phase-2 tool nodes (spec/26 §6).
    const nodes = req.body.nodes !== undefined ? normalizeNodes(req.body.nodes).nodes : undefined;

    // The client store prevents cycles as you draw them, but that guard doesn't
    // exist for a direct API call or a cloned template - so enforce it here too.
    const live = hub.getDraft(workflow._id);
    const nextNodes = nodes !== undefined ? nodes : (live?.nodes ?? workflow.nodes);
    const nextEdges = edges !== undefined ? edges : (live?.edges ?? workflow.edges);
    if ((nodes !== undefined || edges !== undefined) && findCycle(nextNodes, nextEdges)) {
      throw new HttpError(400, 'Workflow graph contains a cycle');
    }
    // A node may only reference this workspace's connections, for its own
    // integration (spec/25) - checked at save so the mistake surfaces here,
    // not as a failed run later.
    if (nodes !== undefined) await validateNodeConnections(req.workspaceId, nodes);
    // spec/37: an agent may only be handed side-effecting tools when its config
    // says so explicitly (allowSideEffects). The run-time gate enforces it too.
    if (nodes !== undefined) {
      const toolProblem = await validateAgentTools(req.workspaceId, nodes);
      if (toolProblem) throw new HttpError(400, toolProblem);
    }
    if (nodes !== undefined || edges !== undefined) {
      const problems = validateNodeStructure(nextNodes, nextEdges);
      if (problems.length) throw new HttpError(400, problems[0].message || String(problems[0]));
    }
    // Same rule the collab op filter applies (spec/31): a PUT must not be a way
    // around code:author.
    if (nodes !== undefined) {
      const denied = checkCodeAuthorship(live?.nodes ?? workflow.nodes, nodes, req.role);
      if (denied) throw new HttpError(403, denied);
    }

    // Through the hub, not a direct save (spec/28 §8): live collaborators get a
    // `collab:snapshot` and the write is sequenced with their ops.
    const draftSeq = await hub.replace(workflow, { name, nodes, edges }, { by: { userId: req.userId }, reason: 'replaced' });
    const doc = presentWorkflow(workflow, req);
    Object.assign(doc, {
      name: name !== undefined ? name : (live?.name ?? doc.name),
      nodes: nextNodes,
      edges: nextEdges,
      draftSeq,
    });
    res.json(doc);
  } catch (err) {
    next(err);
  }
}

export async function remove(req, res, next) {
  try {
    const workflow = await findInWorkspace(Workflow, req.params.id, req);
    // Waiting runs are cancelled first, so nothing resumes against a missing
    // graph (spec/32 edge cases).
    await cancelWaitingRunsForWorkflow(workflow._id);
    await workflow.deleteOne();
    // Its versions go with it (spec/30 §1); its runs are orphaned, as before.
    await WorkflowVersion.deleteMany(scopedFilter(req, { workflowId: workflow._id }));
    // Anyone with it open is told and routed away (spec/28 §8).
    hub.close(workflow._id, { by: { userId: req.userId }, reason: 'deleted' });
    await audit(req, 'workflow.deleted', { type: 'workflow', id: workflow._id, name: workflow.name });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
