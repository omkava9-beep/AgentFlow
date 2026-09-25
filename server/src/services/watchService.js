import WorkflowWatch from '../models/WorkflowWatch.js';
import Workflow from '../models/Workflow.js';
import Workspace from '../models/Workspace.js';
import { notify } from './notify.js';

/**
 * Workflow watching (spec/29 §5). The creator watches implicitly; a row exists
 * only for an explicit choice - `watching: true` (the button, or a first
 * comment) or `watching: false` (an unwatch, including the creator's).
 */

export async function isWatching(workflow, userId) {
  const row = await WorkflowWatch.findOne({ workflowId: workflow._id, userId }).lean();
  if (row) return row.watching;
  return Boolean(workflow.createdBy) && String(workflow.createdBy) === String(userId);
}

export async function setWatching(workflow, userId, watching) {
  await WorkflowWatch.updateOne(
    { workflowId: workflow._id, userId },
    { $set: { watching }, $setOnInsert: { workspaceId: workflow.workspaceId } },
    { upsert: true },
  );
}

/** A first comment subscribes you - unless you already chose either way. */
export async function autoWatch(workflow, userId) {
  await WorkflowWatch.updateOne(
    { workflowId: workflow._id, userId },
    { $setOnInsert: { workspaceId: workflow.workspaceId, watching: true } },
    { upsert: true },
  );
}

export async function watchersOf(workflow) {
  const rows = await WorkflowWatch.find({ workflowId: workflow._id }).select('userId watching').lean();
  const ids = new Set(rows.filter((r) => r.watching).map((r) => String(r.userId)));
  const creator = workflow.createdBy && String(workflow.createdBy);
  if (creator && !rows.some((r) => String(r.userId) === creator)) ids.add(creator);
  return [...ids];
}

/**
 * Called when a run settles (services/runService.js, off the `done` promise, so
 * the engine itself stays untouched). Only top-level `failed` runs notify:
 * a child run's failure already fails - and notifies through - its parent, and
 * a cancelled run is `cancelled`, not `failed`, so nobody is told about a stop
 * they asked for.
 *
 * Collapses per workflow (`run_failed:<workflowId>`): the unread row is bumped
 * and re-pointed at the newest failed run.
 */
export async function notifyRunFinished(run) {
  if (!run || run.status !== 'failed' || run.parentRunId) return;
  const workflow = await Workflow.findById(run.workflowId).select('name workspaceId createdBy').lean(); // tenancy: capability lookup (id from our own run)
  if (!workflow) return;
  const workspace = await Workspace.findById(workflow.workspaceId).select('slug').lean();
  if (!workspace) return;

  const failedNode = (run.nodeResults || []).find((r) => r.status === 'failed' && !r.handled);
  const reason = run.cancelReason === 'timeout'
    ? 'Timed out'
    : failedNode ? `${failedNode.nodeId} failed` : 'Run failed';

  await notify(await watchersOf(workflow), {
    workspaceId: workflow.workspaceId,
    kind: 'run_failed',
    title: `${workflow.name} failed`,
    body: `${reason} · ${run.trigger || 'manual'} run`,
    link: `/w/${workspace.slug}/runs/${run._id}`,
    actorId: null,
    groupKey: `run_failed:${workflow._id}`,
  });
}
