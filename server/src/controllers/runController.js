import Run from '../models/Run.js';
import { findOwned } from './workflowController.js';
import { HttpError } from '../middleware/errorHandler.js';
import { requestCancel } from '../engine/executeRun.js';
import { createAndStartRun, SKIP_REASONS } from '../services/runService.js';

export async function createRun(req, res, next) {
  try {
    const workflow = await findOwned(req.params.id, req.userId);
    const result = await createAndStartRun(workflow, { trigger: 'manual' });

    if (!result.ok) {
      throw result.reason === SKIP_REASONS.ALREADY_RUNNING
        ? new HttpError(409, 'This workflow already has a run in progress')
        : new HttpError(400, 'Workflow must have at least a Start node before it can run');
    }

    res.status(202).json({ runId: result.runId, status: 'pending' });
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
      .select('status startedAt finishedAt createdAt trigger')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const withDuration = runs.map((r) => ({
      id: r._id.toString(),
      status: r.status,
      trigger: r.trigger,
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

const TERMINAL_STATUSES = ['success', 'failed', 'cancelled'];

export async function cancelRun(req, res, next) {
  try {
    const run = await Run.findById(req.params.id);
    if (!run || run.ownerId.toString() !== req.userId) {
      throw new HttpError(404, 'Run not found');
    }
    if (TERMINAL_STATUSES.includes(run.status)) {
      throw new HttpError(409, `Run has already finished (${run.status})`);
    }

    // If the run is executing here, the engine finalizes it cooperatively. If it
    // isn't (the process restarted mid-run, leaving it stuck at 'running'), close
    // it out directly so it can't block the workflow's next run forever.
    if (!requestCancel(req.params.id)) {
      run.status = 'cancelled';
      run.cancelReason = 'user';
      run.finishedAt = new Date();
      await run.save();
    }

    res.status(202).json({ status: 'cancelled' });
  } catch (err) {
    next(err);
  }
}
