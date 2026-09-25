// Human-readable result of an event dispatch (spec/24, spec/27): how many runs
// started and, when some subscribers were skipped, why. "0 runs started" on its
// own leaves the user guessing; the usual reason is an unpublished workflow.
const REASONS = {
  'not-published': 'not published yet',
  'already-running': 'already running',
  'quota-exceeded': 'daily run limit reached',
  'not-runnable': 'no Start node',
};

export function describeDispatch({ triggered = [], skipped = [] } = {}) {
  const started = `${triggered.length} run${triggered.length === 1 ? '' : 's'} started`;
  if (!skipped.length) return started;
  const counts = {};
  for (const s of skipped) {
    const label = REASONS[s.reason] || s.reason || 'skipped';
    counts[label] = (counts[label] || 0) + 1;
  }
  const detail = Object.entries(counts).map(([label, n]) => `${n} ${label}`).join(', ');
  return `${started} · ${skipped.length} skipped (${detail})`;
}
