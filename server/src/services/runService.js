import Run from '../models/Run.js';
import Workflow from '../models/Workflow.js';
import { executeRun } from '../engine/executeRun.js';

export const TRIGGERS = ['manual', 'schedule', 'webhook', 'event'];

/** Reasons a run couldn't be started, for callers that can't just throw an HTTP error. */
export const SKIP_REASONS = {
  NOT_RUNNABLE: 'not-runnable',
  ALREADY_RUNNING: 'already-running',
};

export function isRunnable(workflow) {
  return Boolean(workflow?.nodes?.length && workflow.nodes.some((n) => n.type === 'start'));
}

/**
 * The single entry point every trigger goes through — the manual Run button,
 * cron ticks, webhook calls and event dispatch. Four ways in, one way to start a
 * run, so the guards and the Run document can't drift between them.
 *
 * Returns `{ ok: true, runId }` or `{ ok: false, reason }` rather than throwing:
 * cron and webhook callers have no HTTP request to fail, and a fan-out over many
 * workflows needs to skip one without aborting the rest.
 */
export async function createAndStartRun(workflow, { trigger = 'manual', input = null } = {}) {
  if (!isRunnable(workflow)) {
    return { ok: false, reason: SKIP_REASONS.NOT_RUNNABLE };
  }

  const active = await Run.findOne({ workflowId: workflow._id, status: { $in: ['pending', 'running'] } });
  if (active) {
    return { ok: false, reason: SKIP_REASONS.ALREADY_RUNNING, runId: active._id.toString() };
  }

  const run = await Run.create({
    workflowId: workflow._id,
    ownerId: workflow.ownerId,
    status: 'pending',
    trigger,
    input,
  });

  const runId = run._id.toString();
  // Deliberately not awaited: the caller responds immediately and the run streams
  // its progress over Socket.io.
  executeRun(runId, workflow, { input }).catch((err) => {
    console.error(`Run ${runId} crashed:`, err);
  });

  return { ok: true, runId };
}

/** Loads a workflow fresh before a triggered run, so cron/webhook use the current graph. */
export async function startRunForWorkflowId(workflowId, options) {
  const workflow = await Workflow.findById(workflowId);
  if (!workflow) return { ok: false, reason: 'not-found' };
  return createAndStartRun(workflow, options);
}
