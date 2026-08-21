import mongoose from 'mongoose';
import Workflow from '../models/Workflow.js';
import { HttpError } from '../middleware/errorHandler.js';
import { findCycle } from '../engine/topologicalOrder.js';

export async function list(req, res, next) {
  try {
    const workflows = await Workflow.aggregate([
      { $match: { ownerId: new mongoose.Types.ObjectId(req.userId) } },
      {
        $project: {
          name: 1,
          updatedAt: 1,
          createdAt: 1,
          nodeCount: { $size: '$nodes' },
          edgeCount: { $size: '$edges' },
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
    const workflow = await Workflow.create({ ownerId: req.userId, name, nodes: [], edges: [] });
    res.status(201).json(workflow);
  } catch (err) {
    next(err);
  }
}

async function findOwned(id, ownerId) {
  const workflow = await Workflow.findById(id);
  if (!workflow || workflow.ownerId.toString() !== ownerId) {
    throw new HttpError(404, 'Workflow not found');
  }
  return workflow;
}

export async function getById(req, res, next) {
  try {
    const workflow = await findOwned(req.params.id, req.userId);
    res.json(workflow);
  } catch (err) {
    next(err);
  }
}

export async function update(req, res, next) {
  try {
    const workflow = await findOwned(req.params.id, req.userId);
    const { name, nodes, edges } = req.body;

    // The client store prevents cycles as you draw them, but that guard doesn't
    // exist for a direct API call or a cloned template - so enforce it here too.
    const nextNodes = nodes !== undefined ? nodes : workflow.nodes;
    const nextEdges = edges !== undefined ? edges : workflow.edges;
    if ((nodes !== undefined || edges !== undefined) && findCycle(nextNodes, nextEdges)) {
      throw new HttpError(400, 'Workflow graph contains a cycle');
    }

    if (name !== undefined) workflow.name = name;
    if (nodes !== undefined) workflow.nodes = nodes;
    if (edges !== undefined) workflow.edges = edges;
    await workflow.save();
    res.json(workflow);
  } catch (err) {
    next(err);
  }
}

export async function remove(req, res, next) {
  try {
    const workflow = await findOwned(req.params.id, req.userId);
    await workflow.deleteOne();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export { findOwned };
