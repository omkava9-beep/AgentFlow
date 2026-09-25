import { Tooltip } from '../ui';
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
    <div className={compact ? 'mt-2' : 'mt-3'}>
      <div className="flex h-2.5 w-full items-stretch gap-px overflow-hidden rounded-full bg-bg-subtle" aria-label="Attempts over time">
        {segments.map((s, i) => (
          <Tooltip
            key={i}
            content={s.kind === 'attempt'
              ? `Attempt ${s.entry.attempt}: ${s.entry.outcome}${s.entry.cached ? ' (cache hit)' : ''} · ${formatDuration(s.entry.durationMs)}${s.entry.error ? ` · ${s.entry.error}` : ''}`
              : `Backoff: waited ${formatDuration(s.ms)}`}
          >
            <div
              style={{ flexGrow: s.ms / span, flexBasis: s.kind === 'attempt' ? 6 : 2 }}
              className={s.kind === 'gap'
                ? 'bg-[repeating-linear-gradient(90deg,rgb(var(--border-strong))_0_2px,transparent_2px_5px)] opacity-60'
                : s.entry.outcome === 'success' ? 'rounded-full bg-success' : 'rounded-full bg-danger'}
            />
          </Tooltip>
        ))}
      </div>
      <p className="mt-1 text-2xs tabular-nums text-subtle">
        {attempts.length} attempt{attempts.length === 1 ? '' : 's'}
        {waits.length > 0 && ` · waited ${waits.map((w) => formatDuration(w)).join(', ')}`}
        {attempts.some((a) => a.cached) && ' · cache hit'}
        {attempts[attempts.length - 1].truncated && ' · …more attempts truncated'}
      </p>
    </div>
  );
}
