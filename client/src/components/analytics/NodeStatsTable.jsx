import { useState } from 'react';
import { formatDuration, formatPercent } from '../../utils/format';

const COLUMNS = [
  { key: 'label', label: 'Node' },
  { key: 'runs', label: 'Runs', numeric: true },
  { key: 'successRate', label: 'Success', numeric: true, format: (v) => formatPercent(v) },
  { key: 'avgDurationMs', label: 'Avg', numeric: true, format: formatDuration },
  { key: 'p95DurationMs', label: 'p95', numeric: true, format: formatDuration },
  { key: 'retryRate', label: 'Retry rate', numeric: true, format: (v) => formatPercent(v) },
  { key: 'avgAttempts', label: 'Avg attempts', numeric: true, format: (v) => (v == null ? '—' : v.toFixed(2)) },
  { key: 'cacheHitRate', label: 'Cache hits', numeric: true, format: (v) => formatPercent(v) },
  { key: 'handledFailures', label: 'Handled', numeric: true },
];

/**
 * spec/35 §5: per-node stats for one workflow, sortable, with the slowest and
 * flakiest nodes called out so "which node is the problem?" has an answer.
 */
export default function NodeStatsTable({ stats = [] }) {
  const [sort, setSort] = useState({ key: 'p95DurationMs', dir: -1 });
  if (!stats.length) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">No node executions in this range yet.</p>;
  }
  const sorted = [...stats].sort((a, b) => {
    const x = a[sort.key], y = b[sort.key];
    if (typeof x === 'string') return sort.dir * x.localeCompare(y);
    return sort.dir * ((x ?? -1) - (y ?? -1));
  });
  const slowest = [...stats].filter((s) => s.p95DurationMs != null).sort((a, b) => b.p95DurationMs - a.p95DurationMs)[0];
  const flakiest = [...stats].filter((s) => s.retryRate > 0 || s.successRate < 1).sort((a, b) => (b.retryRate - a.retryRate) || (a.successRate - b.successRate))[0];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {slowest && (
          <span className="rounded-lg bg-amber-50 px-2 py-1 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Slowest: <strong>{slowest.label}</strong> · p95 {formatDuration(slowest.p95DurationMs)}
          </span>
        )}
        {flakiest && (
          <span className="rounded-lg bg-red-50 px-2 py-1 text-red-800 dark:bg-red-950 dark:text-red-200">
            Flakiest: <strong>{flakiest.label}</strong> · retries {formatPercent(flakiest.retryRate)} · success {formatPercent(flakiest.successRate)}
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-slate-400">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} className={`px-2 py-1.5 ${c.numeric ? 'text-right' : ''}`}>
                  <button
                    type="button"
                    className="uppercase hover:text-slate-600 dark:hover:text-slate-200"
                    onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? -s.dir : -1 }))}
                  >
                    {c.label}{sort.key === c.key ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.nodeId} className="border-t border-slate-100 dark:border-slate-800">
                {COLUMNS.map((c) => (
                  <td key={c.key} className={`px-2 py-1.5 ${c.numeric ? 'text-right tabular-nums' : ''} ${row.label === '(deleted node)' && c.key === 'label' ? 'italic text-slate-400' : 'text-slate-700 dark:text-slate-200'}`}>
                    {c.format ? c.format(row[c.key]) : row[c.key]}
                    {c.key === 'label' && row.type && <span className="ml-1 text-[10px] text-slate-400">{row.type}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
