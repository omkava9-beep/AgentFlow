import mongoose from 'mongoose';
import Workflow from '../models/Workflow.js';
import Run from '../models/Run.js';
import User from '../models/User.js';
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
    const workspaceOid = new mongoose.Types.ObjectId(req.workspaceId);
    // aggregate() skips Mongoose casting, so the id has to be an ObjectId here.
    const workflows = await Workflow.aggregate([
      { $match: scopedFilter(req, { workspaceId: workspaceOid }) },
      {
        $project: {
          name: 1,
          updatedAt: 1,
          createdAt: 1,
          createdBy: 1,
          updatedBy: 1,
          nodeCount: { $size: '$nodes' },
          edgeCount: { $size: '$edges' },
          // spec/30: the dashboard's "v3" badge and its unpublished-changes dot.
          publishedVersion: { $ifNull: ['$publishedVersion', null] },
          hasUnpublishedChanges: { $ifNull: ['$hasUnpublishedChanges', false] },
          // What the list shows at a glance: the node kinds used, the tools'
          // integrations, and which automatic triggers are switched on.
          nodeTypes: { $setUnion: ['$nodes.type', []] },
          integrations: { $setUnion: ['$nodes.data.config.integration', []] },
          schedule: { enabled: '$schedule.enabled', cronExpression: '$schedule.cronExpression' },
          webhookEnabled: { $ifNull: ['$webhook.enabled', false] },
          eventTrigger: { enabled: '$eventTrigger.enabled', eventName: '$eventTrigger.eventName' },
        },
      },
      { $sort: { updatedAt: -1 } },
    ]);

    const ids = workflows.map((w) => w._id);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    since.setUTCHours(0, 0, 0, 0);
    const runScope = scopedFilter(req, { workspaceId: workspaceOid, workflowId: { $in: ids }, parentRunId: null });
    const [lastRuns, weekly, users] = await Promise.all([
      // Latest top-level run per workflow (child runs of loops/sub-workflows excluded).
      Run.aggregate([
        { $match: runScope },
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$workflowId', id: { $first: '$_id' }, status: { $first: '$status' }, trigger: { $first: '$trigger' }, isDraft: { $first: '$isDraft' }, startedAt: { $first: '$startedAt' }, finishedAt: { $first: '$finishedAt' }, createdAt: { $first: '$createdAt' } } },
      ]),
      // Last 7 days, per workflow per UTC day: the list's sparkline and success rate.
      Run.aggregate([
        { $match: { ...runScope, createdAt: { $gte: since } } },
        { $group: {
          _id: { wf: '$workflowId', day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } },
          total: { $sum: 1 },
          success: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        } },
      ]),
      User.find({ _id: { $in: [...new Set(workflows.flatMap((w) => [w.createdBy, w.updatedBy]).filter(Boolean).map(String))] } }).select('name email').lean(),
    ]);

    const lastByWf = new Map(lastRuns.map((r) => [String(r._id), r]));
    const days = Array.from({ length: 8 }, (_, i) => new Date(since.getTime() + i * 86400000).toISOString().slice(0, 10));
    const weeklyByWf = new Map();
    for (const row of weekly) {
      const key = String(row._id.wf);
      const entry = weeklyByWf.get(key) || { total: 0, success: 0, failed: 0, byDay: {} };
      entry.total += row.total; entry.success += row.success; entry.failed += row.failed;
      entry.byDay[row._id.day] = row.total;
      weeklyByWf.set(key, entry);
    }
    const userById = new Map(users.map((u) => [String(u._id), { id: String(u._id), name: u.name || u.email, email: u.email }]));

    res.json(workflows.map((w) => {
      const week = weeklyByWf.get(String(w._id));
      const last = lastByWf.get(String(w._id));
      const triggers = [
        w.schedule?.enabled && { type: 'schedule', detail: w.schedule.cronExpression },
        w.webhookEnabled && { type: 'webhook' },
        w.eventTrigger?.enabled && { type: 'event', detail: w.eventTrigger.eventName },
      ].filter(Boolean);
      return {
        _id: w._id,
        name: w.name,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
        nodeCount: w.nodeCount,
        edgeCount: w.edgeCount,
        publishedVersion: w.publishedVersion,
        hasUnpublishedChanges: w.hasUnpublishedChanges,
        nodeTypes: (w.nodeTypes || []).filter(Boolean),
        integrations: (w.integrations || []).filter(Boolean),
        triggers,
        lastRun: last ? { id: String(last.id), status: last.status, trigger: last.trigger, isDraft: Boolean(last.isDraft), startedAt: last.startedAt || last.createdAt, finishedAt: last.finishedAt || null } : null,
        stats7d: {
          total: week?.total || 0,
          success: week?.success || 0,
          failed: week?.failed || 0,
          daily: days.map((d) => week?.byDay[d] || 0),
        },
        createdBy: userById.get(String(w.createdBy)) || null,
        updatedBy: userById.get(String(w.updatedBy)) || userById.get(String(w.createdBy)) || null,
      };
    }));
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
