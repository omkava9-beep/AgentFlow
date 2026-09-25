import Template from '../models/Template.js';
import Workflow from '../models/Workflow.js';
import User from '../models/User.js';
import { hub } from '../collab/hub.js';
import { HttpError } from '../middleware/errorHandler.js';
import { findInWorkspace, createInWorkspace, isValidObjectId, scopedFilter } from '../tenancy/scoped.js';
import { findCycle } from '../engine/topologicalOrder.js';
import { normalizeNodes } from '../integrations/normalizeToolConfig.js';
import { stripConnectionIds } from '../services/connectionService.js';
import { audit } from '../services/audit.js';

/** Deep copy so a template and its clones can never share nested config objects. */
const snapshot = (value) => JSON.parse(JSON.stringify(value ?? []));

/**
 * The one place templates widen past the workspace: built-ins (workspaceId: null)
 * are visible everywhere, alongside this workspace's own. Overriding the scoped
 * filter's workspaceId keeps that widening explicit at each call site.
 */
const builtInOrOwn = (req) => ({ workspaceId: { $in: [null, req.workspaceId] } });

function present(template, userId, names = new Map()) {
  return {
    _id: template._id,
    name: template.name,
    description: template.description,
    nodes: template.nodes,
    edges: template.edges,
    nodeCount: template.nodes?.length || 0,
    edgeCount: template.edges?.length || 0,
    builtIn: template.workspaceId === null || template.workspaceId === undefined,
    mine: Boolean(template.createdBy && userId && String(template.createdBy) === String(userId)),
    createdBy: template.createdBy ?? null,
    // "by Bob · 3 days ago" (spec/36 §5).
    createdByName: template.createdBy ? names.get(String(template.createdBy)) || null : null,
    createdAt: template.createdAt,
  };
}

export async function list(req, res, next) {
  try {
    // Built-ins (workspaceId: null) plus this workspace's - shared with teammates,
    // never another workspace's.
    const templates = await Template.find(scopedFilter(req, builtInOrOwn(req))).sort({
      workspaceId: 1,
      createdAt: -1,
    });
    const creatorIds = [...new Set(templates.map((t) => t.createdBy).filter(Boolean).map(String))];
    const users = creatorIds.length ? await User.find({ _id: { $in: creatorIds } }).select('name email').lean() : [];
    const names = new Map(users.map((u) => [String(u._id), u.name || u.email.split('@')[0]]));
    res.json(templates.map((t) => present(t, req.userId, names)));
  } catch (err) {
    next(err);
  }
}

export async function createFromWorkflow(req, res, next) {
  try {
    const { workflowId, name, description } = req.body || {};
    if (!workflowId) throw new HttpError(400, 'workflowId is required');

    // The template snapshots the draft as collaborators see it now (spec/28 §9):
    // flush the hub first, so the read below is current.
    await hub.flushBeforeRead(workflowId);
    const workflow = await findInWorkspace(Workflow, workflowId, req);
    const trimmed = String(name || '').trim() || `${workflow.name} template`;

    const template = await createInWorkspace(Template, req, {
      name: trimmed,
      description: String(description || '').trim(),
      // A snapshot, not a reference: later edits to the workflow must not follow
      // through into the template.
      // Connections belong to one workspace (spec/25); a template is shareable,
      // so it carries the node shape without the connection reference.
      nodes: stripConnectionIds(normalizeNodes(snapshot(workflow.nodes)).nodes),
      edges: snapshot(workflow.edges),
    });

    res.status(201).json(present(template, req.userId));
  } catch (err) {
    next(err);
  }
}

export async function useTemplate(req, res, next) {
  try {
    // A built-in, or one of this workspace's own. Another workspace's template
    // shouldn't even be visible, so it gets the same 404 as a missing one.
    const template = isValidObjectId(req.params.id)
      ? await Template.findOne(scopedFilter(req, { _id: req.params.id, ...builtInOrOwn(req) }))
      : null;
    if (!template) throw new HttpError(404, 'Template not found');

    // A template stored before the tool-node migration clones in the new shape.
    const nodes = normalizeNodes(snapshot(template.nodes)).nodes;
    const edges = snapshot(template.edges);

    // Cloning bypasses the PUT route's guard, so check here too - a template
    // stored before that validation existed could still carry a cycle.
    if (findCycle(nodes, edges)) {
      throw new HttpError(400, 'This template contains a cycle and cannot be used');
    }

    const workflow = await createInWorkspace(Workflow, req, {
      name: String(req.body?.workflowName || '').trim() || `${template.name} copy`,
      nodes,
      edges,
    });

    res.status(201).json(workflow);
  } catch (err) {
    next(err);
  }
}

/**
 * Loads a template the caller may manage (spec/36 §5): this workspace's own.
 * Built-ins are visible but immutable (403); another workspace's template is
 * invisible, so it gets the same 404 as a missing one.
 */
async function findManageable(req) {
  const template = isValidObjectId(req.params.id)
    ? await Template.findOne(scopedFilter(req, { _id: req.params.id, ...builtInOrOwn(req) }))
    : null;
  if (!template) throw new HttpError(404, 'Template not found');
  if (template.workspaceId === null || template.workspaceId === undefined) {
    throw new HttpError(403, 'Built-in templates cannot be changed');
  }
  return template;
}

export async function updateTemplate(req, res, next) {
  try {
    const template = await findManageable(req);
    const { name, description } = req.body || {};
    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) throw new HttpError(400, 'Name is required');
      template.name = trimmed;
    }
    if (description !== undefined) template.description = String(description).trim();
    await template.save();
    res.json(present(template, req.userId));
  } catch (err) {
    next(err);
  }
}

/** Workflows already created from it are copies (spec/15), so they're unaffected. */
export async function deleteTemplate(req, res, next) {
  try {
    const template = await findManageable(req);
    await Template.deleteOne(scopedFilter(req, { _id: template._id }));
    await audit(req, 'template.deleted', { type: 'template', id: template._id, name: template.name });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
