import Run from '../models/Run.js';

/**
 * One re-armable timer per waiting node that has a `resumeAt` (spec/32 §5): an
 * approval timeout or a parked long delay. Timers are cheap and in-memory; the
 * `resumeAt` in MongoDB is the source of truth, and `bootstrapWaits()` re-arms
 * them after a restart. Anything already past fires immediately.
 */
const timers = new Map();
// setTimeout's ceiling (~24.8 days); longer waits re-arm in hops.
const MAX_TIMER_MS = 2 ** 31 - 1;

const keyOf = (runId, nodeId) => `${runId}:${nodeId}`;

export function armWait(runId, nodeId, resumeAt) {
  if (!resumeAt) return;
  const key = keyOf(runId, nodeId);
  clearWait(runId, nodeId);
  const delay = Math.max(0, new Date(resumeAt).getTime() - Date.now());
  const handle = setTimeout(async () => {
    timers.delete(key);
    if (delay > MAX_TIMER_MS) return armWait(runId, nodeId, resumeAt);
    try {
      // Lazy: resumeService imports the engine, which imports this module.
      const { onWaitTimer } = await import('../services/resumeService.js');
      await onWaitTimer(String(runId), nodeId);
    } catch (err) {
      console.error(`[waits] timer for ${key} failed:`, err);
    }
  }, Math.min(delay, MAX_TIMER_MS));
  handle.unref?.();
  timers.set(key, handle);
}

export function clearWait(runId, nodeId) {
  const key = keyOf(runId, nodeId);
  const handle = timers.get(key);
  if (handle) clearTimeout(handle);
  timers.delete(key);
}

export function clearWaitsForRun(runId) {
  const prefix = `${runId}:`;
  for (const [key, handle] of timers) {
    if (key.startsWith(prefix)) {
      clearTimeout(handle);
      timers.delete(key);
    }
  }
}

export function armedCount() {
  return timers.size;
}

/** On boot, after the reconciler: re-arm every waiting node with a resumeAt. */
export async function bootstrapWaits() {
  const runs = await Run.find({ status: 'waiting' }).select('nodeResults.nodeId nodeResults.status nodeResults.resumeAt').lean();
  let armed = 0;
  for (const run of runs) {
    for (const r of run.nodeResults || []) {
      if (r.status === 'waiting' && r.resumeAt) {
        armWait(String(run._id), r.nodeId, r.resumeAt);
        armed += 1;
      }
    }
  }
  return { waitingRuns: runs.length, armed };
}
