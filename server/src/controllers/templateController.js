import Template from '../models/Template.js';
import Workflow from '../models/Workflow.js';
import { HttpError } from '../middleware/errorHandler.js';
import { findOwned } from './workflowController.js';
import { findCycle } from '../engine/topologicalOrder.js';

/** Deep copy so a template and its clones can never share nested config objects. */
const snapshot = (value) => JSON.parse(JSON.stringify(value ?? []));

function present(template, userId) {
  return {
    _id: template._id,
    name: template.name,
    description: template.description,
    nodes: template.nodes,
    edges: template.edges,
    nodeCount: template.nodes?.length || 0,
    edgeCount: template.edges?.length || 0,
    builtIn: template.ownerId === null || template.ownerId === undefined,
    mine: Boolean(template.ownerId && userId && String(template.ownerId) === String(userId)),
    createdAt: template.createdAt,
  };
}

export async function list(req, res, next) {
  try {
    // Built-ins (ownerId: null) plus the caller's own - never another user's.
    const templates = await Template.find({ $or: [{ ownerId: null }, { ownerId: req.userId }] }).sort({
      ownerId: 1,
      createdAt: -1,
    });
    res.json(templates.map((t) => present(t, req.userId)));
  } catch (err) {
    next(err);
  }
}

export async function createFromWorkflow(req, res, next) {
  try {
    const { workflowId, name, description } = req.body || {};
    if (!workflowId) throw new HttpError(400, 'workflowId is required');

    const workflow = await findOwned(workflowId, req.userId);
    const trimmed = String(name || '').trim() || `${workflow.name} template`;

    const template = await Template.create({
      ownerId: req.userId,
      name: trimmed,
      description: String(description || '').trim(),
      // A snapshot, not a reference: later edits to the workflow must not follow
      // through into the template.
      nodes: snapshot(workflow.nodes),
      edges: snapshot(workflow.edges),
    });

    res.status(201).json(present(template, req.userId));
  } catch (err) {
    next(err);
  }
}

export async function useTemplate(req, res, next) {
  try {
    const template = await Template.findById(req.params.id);
    // A template you don't own and isn't built-in shouldn't even be visible.
    if (!template || (template.ownerId && String(template.ownerId) !== String(req.userId))) {
      throw new HttpError(404, 'Template not found');
    }

    const nodes = snapshot(template.nodes);
    const edges = snapshot(template.edges);

    // Cloning bypasses the PUT route's guard, so check here too - a template
    // stored before that validation existed could still carry a cycle.
    if (findCycle(nodes, edges)) {
      throw new HttpError(400, 'This template contains a cycle and cannot be used');
    }

    const workflow = await Workflow.create({
      ownerId: req.userId,
      name: String(req.body?.workflowName || '').trim() || `${template.name} copy`,
      nodes,
      edges,
    });

    res.status(201).json(workflow);
  } catch (err) {
    next(err);
  }
}
