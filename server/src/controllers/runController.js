import Run from '../models/Run.js';
import { findOwned } from './workflowController.js';
import { HttpError } from '../middleware/errorHandler.js';
import { executeRun } from '../engine/executeRun.js';

export async function createRun(req, res, next) {
  try {
    const workflow = await findOwned(req.params.id, req.userId);

    if (!workflow.nodes.length || !workflow.nodes.some((n) => n.type === 'start')) {
      throw new HttpError(400, 'Workflow must have at least a Start node before it can run');
    }

    const existingActive = await Run.findOne({ workflowId: workflow._id, status: { $in: ['pending', 'running'] } });
    if (existingActive) {
      throw new HttpError(409, 'This workflow already has a run in progress');
    }

    const run = await Run.create({ workflowId: workflow._id, ownerId: req.userId, status: 'pending' });
    res.status(202).json({ runId: run._id.toString(), status: run.status });

    executeRun(run._id.toString(), workflow).catch((err) => {
      console.error('Run execution crashed:', err);
    });
  } catch (err) {
    next(err);
  }
}

export async function listRunsForWorkflow(req, res, next) {
  try {
    await findOwned(req.params.id, req.userId);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 20;
    const runs = await Run.find({ workflowId: req.params.id })
      .select('status startedAt finishedAt createdAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const withDuration = runs.map((r) => ({
      id: r._id.toString(),
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      durationMs: r.startedAt && r.finishedAt ? r.finishedAt - r.startedAt : null,
    }));
    res.json(withDuration);
  } catch (err) {
    next(err);
  }
}

export async function getRunById(req, res, next) {
  try {
    const run = await Run.findById(req.params.id);
    if (!run || run.ownerId.toString() !== req.userId) {
      throw new HttpError(404, 'Run not found');
    }
    res.json(run);
  } catch (err) {
    next(err);
  }
}
