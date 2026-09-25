import { GanttChart } from 'lucide-react';
import { formatDuration } from '../../utils/format';
import { EmptyState, Tooltip, StatusIcon } from '../ui';

const BAR = {
  success: 'bg-success/80',
  failed: 'bg-danger/80',
  running: 'bg-info/80 animate-pulse',
  waiting: 'bg-warning/80',
  skipped: 'bg-[rgb(var(--border-strong))]',
  pending: 'bg-bg-subtle',
};

/**
 * spec/35 §6: the whole run as a Gantt chart - one row per node, bars from
 * start to finish with attempt segments inside. Concurrent fan-out, queue
 * waits, delays and approvals all read at a glance.
 */
export default function RunGantt({ run, labelOf = (id) => id }) {
  const rows = (run?.nodeResults || []).filter((r) => r.startedAt);
  if (!rows.length) {
    return <div className="p-6"><EmptyState compact icon={GanttChart} title="Nothing has started yet" body="Bars appear as nodes start running." /></div>;
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
      <div className="mb-2 flex justify-between pl-44 pr-16 text-2xs tabular-nums text-subtle">
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
              <span className="flex w-[10.5rem] shrink-0 items-center gap-1.5 truncate text-muted">
                <StatusIcon status={r.status} className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{labelOf(r.nodeId)}</span>
                {r.reused && <span className="text-2xs text-subtle">reused</span>}
              </span>
              <div className="relative h-5 flex-1 rounded bg-bg-subtle">
                <Tooltip content={`${labelOf(r.nodeId)} · ${r.status} · ${formatDuration(r.durationMs ?? Math.round(end - start))}${r.queuedMs ? ` · queued ${formatDuration(r.queuedMs)}` : ''}`}>
                <div
                  className={`absolute top-0 h-5 overflow-hidden rounded ${BAR[r.status] || BAR.pending} ${r.reused ? 'opacity-40' : ''}`}
                  style={{ left: pct(start), width: pct(width) }}
                >
                  {/* Attempt segments inside the bar, so retries and backoff show within the node's own span. */}
                  {(r.attemptsLog || []).map((a) => {
                    const aStart = t(a.startedAt) - t0 - start;
                    const aEnd = t(a.finishedAt || a.startedAt) - t0 - start;
                    return (
                      <div
                        key={a.attempt}
                        className={`absolute top-1 h-3 rounded-sm ${a.outcome === 'success' ? 'bg-black/25' : 'bg-black/40'}`}
                        style={{ left: `${(aStart / width) * 100}%`, width: `${Math.max(1, ((aEnd - aStart) / width) * 100)}%` }}
                      />
                    );
                  })}
                </div>
                </Tooltip>
              </div>
              <span className="w-14 shrink-0 text-right text-2xs tabular-nums text-subtle">{formatDuration(r.durationMs ?? null)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
