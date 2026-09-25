/**
 * Serialises resume and cancel operations per run (spec/32 §4). Everything that
 * moves a waiting run - an approval decision, a timeout, a delay waking up, a
 * cancel - goes through here, so two of them for the same run never interleave
 * inside this process. The conditional MongoDB update in resumeRun is still the
 * real lock against double decisions; this just keeps the in-process
 * bookkeeping (active engine vs. parked) consistent. Single instance, so a
 * process-local queue is enough.
 */
const tails = new Map();

export function withRunLock(runId, fn) {
  const key = String(runId);
  const previous = tails.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  const tail = next.catch(() => {});
  tails.set(key, tail);
  tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
  return next;
}
