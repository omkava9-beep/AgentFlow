import Run from '../models/Run.js';
import Workflow from '../models/Workflow.js';
import { withRunLock } from '../engine/runLocks.js';
import { clearWait } from '../engine/waitTimers.js';
import { deliverResolution, parked, resumeEngine } from '../engine/executeRun.js';
import { notifyRunFinished } from './watchService.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The graph a waiting run resumes on: its pinned version or draft snapshot
 * (spec/30), never the current draft. Runs from before versioning recorded
 * neither, and neither do runs started directly by the check scripts - those
 * fall back to the workflow's current graph.
 */
async function graphFor(run) {
  try {
    const { loadRunGraph } = await import('./versionService.js');
    const g = await loadRunGraph(run);
    return { _id: run.workflowId, workspaceId: run.workspaceId, name: g.name, nodes: g.nodes, edges: g.edges };
  } catch {
    const wf = await Workflow.findOne({ _id: run.workflowId, workspaceId: run.workspaceId }).lean();
    if (!wf) return null;
    return { _id: wf._id, workspaceId: wf.workspaceId, name: wf.name, nodes: wf.nodes, edges: wf.edges };
  }
}

/**
 * spec/32 §4. Every decision, approval timeout and delay wake-up comes through
 * here. `approvalEntry` is pushed onto the node's approvals as part of the
 * claim, so a final decision is recorded atomically with winning the lock.
 *
 * → `{ ok: true }` or `{ ok: false, reason: 'already-decided' | 'not-found' }`.
 */
export function resumeRun(runId, { nodeId, resolution, approvalEntry = null }) {
  const id = String(runId);
  return withRunLock(id, async () => {
    // 1. The claim IS the lock: only one caller can move this node off `waiting`.
    const update = {
      $set: { 'nodeResults.$.status': 'running' },
      $pull: { waiting: { nodeId } },
    };
    if (approvalEntry) update.$push = { 'nodeResults.$.approval.approvals': approvalEntry };
    const claimed = await Run.findOneAndUpdate(
      { _id: id, status: { $in: ['waiting', 'running'] }, nodeResults: { $elemMatch: { nodeId, status: 'waiting' } } },
      update,
      { returnDocument: 'after' },
    ).lean();
    if (!claimed) return { ok: false, reason: 'already-decided' };
    clearWait(id, nodeId);

    const resolutionItem = { nodeId, resolution };
    // 2a. The engine is driving this run right now (another branch in flight).
    if (deliverResolution(id, resolutionItem)) return { ok: true };

    // 2b. Parked: wait for a park still being written, then rehydrate.
    await parked(id);
    if (deliverResolution(id, resolutionItem)) return { ok: true };
    let runDoc = null;
    for (let attempt = 0; attempt < 20 && !runDoc; attempt++) {
      runDoc = await Run.findOneAndUpdate(
        { _id: id, status: 'waiting' },
        { $set: { status: 'running' } },
        { returnDocument: 'after' },
      ).lean();
      if (runDoc) break;
      if (deliverResolution(id, resolutionItem)) return { ok: true };
      await sleep(50);
    }
    if (!runDoc) {
      // Claimed but nothing can continue it (the run was cancelled meanwhile).
      await Run.updateOne({ _id: id, 'nodeResults.nodeId': nodeId }, { $set: { 'nodeResults.$.status': 'skipped' } });
      return { ok: false, reason: 'not-found' };
    }

    const workflow = await graphFor(runDoc);
    if (!workflow) {
      await Run.updateOne({ _id: id }, { $set: { status: 'failed', failReason: 'nodes_failed', finishedAt: new Date() } });
      return { ok: false, reason: 'not-found' };
    }
    // Not awaited: the caller answers now and the run streams as usual. A
    // resumed run never goes through createAndStartRun's `done`, so a failure
    // after the approval notifies watchers here (spec/29); it ignores runs that
    // parked again or didn't fail.
    resumeEngine(id, workflow, { runDoc, resolutions: [resolutionItem] })
      .then((finished) => notifyRunFinished(finished))
      .catch((err) => {
        console.error(`Resume of run ${id} crashed:`, err);
      });
    return { ok: true };
  });
}

/** A wait timer fired (spec/32 §5): an approval's default outcome, or a delay waking. */
export async function onWaitTimer(runId, nodeId) {
  const run = await Run.findOne({ _id: runId }, { nodeResults: { $elemMatch: { nodeId } }, status: 1 }).lean();
  const result = run?.nodeResults?.[0];
  if (!result || result.status !== 'waiting') return { ok: false, reason: 'already-decided' };
  if (result.approval) {
    const outcome = result.approval.timeoutOutcome === 'approved' ? 'approved' : 'rejected';
    return resumeRun(runId, {
      nodeId,
      resolution: { decision: outcome, decidedBy: 'timeout', comment: '', decidedAt: new Date(), approvals: result.approval.approvals || [] },
    });
  }
  return resumeRun(runId, { nodeId, resolution: { delay: true } });
}

/** Deleting a workflow cancels its waiting runs first, so nothing resumes against a missing graph. */
export async function cancelWaitingRunsForWorkflow(workflowId) {
  const { cancelWaitingRun } = await import('../engine/executeRun.js');
  const runs = await Run.find({ workflowId, status: 'waiting' }).select('_id').lean(); // tenancy: capability lookup (workflow already authorized by the caller)
  for (const r of runs) await cancelWaitingRun(String(r._id));
  return runs.length;
}
