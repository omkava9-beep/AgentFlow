import { formatDuration } from '../../utils/format';

/**
 * spec/35 §6: a node's attempts as a horizontal track - red bars for failed
 * attempts, green for the one that succeeded - with the backoff gaps between
 * them labelled. Exponential backoff becomes something you can see.
 */
export default function AttemptsTimeline({ attempts = [], compact = false }) {
  if (!attempts.length) return null;
  const first = new Date(attempts[0].startedAt).getTime();
  const last = new Date(attempts[attempts.length - 1].finishedAt || attempts[attempts.length - 1].startedAt).getTime();
  const span = Math.max(1, last - first);

  // Bars and gaps as a single row of flex segments, widths proportional to time.
  const segments = [];
  attempts.forEach((a, i) => {
    const start = new Date(a.startedAt).getTime();
    const end = new Date(a.finishedAt || a.startedAt).getTime();
    segments.push({ kind: 'attempt', entry: a, ms: Math.max(1, end - start) });
    const next = attempts[i + 1];
    if (next) segments.push({ kind: 'gap', ms: Math.max(0, new Date(next.startedAt).getTime() - end), backoffMs: a.backoffMs });
  });

  const waits = attempts.map((a) => a.backoffMs).filter((b) => b != null);
  return (
    <div className={compact ? 'mt-1' : 'mt-2'}>
      <div className="flex h-3 w-full items-stretch overflow-hidden rounded bg-slate-100 dark:bg-slate-800" title="Attempts over time">
        {segments.map((s, i) => (
          <div
            key={i}
            style={{ flexGrow: s.ms / span, flexBasis: s.kind === 'attempt' ? 6 : 2 }}
            title={s.kind === 'attempt'
              ? `Attempt ${s.entry.attempt}: ${s.entry.outcome}${s.entry.cached ? ' (cache hit)' : ''} · ${formatDuration(s.entry.durationMs)}${s.entry.error ? ` · ${s.entry.error}` : ''}`
              : `waited ${formatDuration(s.ms)}`}
            className={s.kind === 'gap'
              ? 'bg-transparent'
              : s.entry.outcome === 'success'
                ? 'rounded-sm bg-emerald-500'
                : 'rounded-sm bg-red-500'}
          />
        ))}
      </div>
      <p className="mt-0.5 text-[10px] text-slate-400">
        {attempts.length} attempt{attempts.length === 1 ? '' : 's'}
        {waits.length > 0 && ` · waited ${waits.map((w) => formatDuration(w)).join(', ')}`}
        {attempts.some((a) => a.cached) && ' · cache hit'}
        {attempts[attempts.length - 1].truncated && ' · …more attempts truncated'}
      </p>
    </div>
  );
}
