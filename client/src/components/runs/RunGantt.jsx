import { formatDuration } from '../../utils/format';

const BAR = {
  success: 'bg-emerald-500/80',
  failed: 'bg-red-500/80',
  running: 'bg-blue-500/80 animate-pulse',
  waiting: 'bg-orange-400/80',
  skipped: 'bg-slate-300 dark:bg-slate-700',
  pending: 'bg-slate-200 dark:bg-slate-800',
};

/**
 * spec/35 §6: the whole run as a Gantt chart - one row per node, bars from
 * start to finish with attempt segments inside. Concurrent fan-out, queue
 * waits, delays and approvals all read at a glance.
 */
export default function RunGantt({ run, labelOf = (id) => id }) {
  const rows = (run?.nodeResults || []).filter((r) => r.startedAt);
  if (!rows.length) {
    return <p className="p-6 text-sm text-slate-500 dark:text-slate-400">Nothing has started yet.</p>;
  }
  const t = (d) => new Date(d).getTime();
  const t0 = Math.min(...rows.map((r) => t(r.startedAt)), run.startedAt ? t(run.startedAt) : Infinity);
  const now = Date.now();
  const tEnd = Math.max(
    ...rows.map((r) => (r.finishedAt ? t(r.finishedAt) : now)),
    run.finishedAt ? t(run.finishedAt) : 0,
  );
  const span = Math.max(1, tEnd - t0);
  const pct = (ms) => `${(ms / span) * 100}%`;
  const sorted = [...rows].sort((a, b) => t(a.startedAt) - t(b.startedAt));

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-2 flex justify-between pl-40 text-[10px] text-slate-400">
        <span>0</span>
        <span>{formatDuration(Math.round(span / 2))}</span>
        <span>{formatDuration(span)}</span>
      </div>
      <div className="space-y-1.5">
        {sorted.map((r) => {
          const start = t(r.startedAt) - t0;
          const end = (r.finishedAt ? t(r.finishedAt) : now) - t0;
          const width = Math.max(end - start, span * 0.004);
          return (
            <div key={r.nodeId} className="flex items-center gap-2 text-xs">
              <span className="w-38 w-[9.5rem] shrink-0 truncate text-slate-600 dark:text-slate-300" title={labelOf(r.nodeId)}>
                {labelOf(r.nodeId)}
                {r.reused && <span className="ml-1 text-[10px] text-slate-400">⟲</span>}
              </span>
              <div className="relative h-5 flex-1 rounded bg-slate-100 dark:bg-slate-900">
                <div
                  className={`absolute top-0 h-5 overflow-hidden rounded ${BAR[r.status] || BAR.pending} ${r.reused ? 'opacity-40' : ''}`}
                  style={{ left: pct(start), width: pct(width) }}
                  title={`${labelOf(r.nodeId)} · ${r.status} · ${formatDuration(r.durationMs ?? Math.round(end - start))}${r.queuedMs ? ` · queued ${formatDuration(r.queuedMs)}` : ''}`}
                >
                  {/* Attempt segments inside the bar, so retries and backoff show within the node's own span. */}
                  {(r.attemptsLog || []).map((a) => {
                    const aStart = t(a.startedAt) - t0 - start;
                    const aEnd = t(a.finishedAt || a.startedAt) - t0 - start;
                    return (
                      <div
                        key={a.attempt}
                        className={`absolute top-1 h-3 rounded-sm ${a.outcome === 'success' ? 'bg-emerald-800/60' : 'bg-red-900/60'}`}
                        style={{ left: `${(aStart / width) * 100}%`, width: `${Math.max(1, ((aEnd - aStart) / width) * 100)}%` }}
                        title={`Attempt ${a.attempt}: ${a.outcome}`}
                      />
                    );
                  })}
                </div>
              </div>
              <span className="w-14 shrink-0 text-right text-[10px] text-slate-400">{formatDuration(r.durationMs ?? null)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
