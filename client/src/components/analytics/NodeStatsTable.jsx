import { Gauge, TriangleAlert, Boxes } from 'lucide-react';
import { DataTable, Badge, NodeTypeIcon } from '../ui';
import { formatDuration, formatPercent } from '../../utils/format';

const num = (v, fmt) => (v == null ? <span className="text-subtle">—</span> : fmt ? fmt(v) : v);

/**
 * spec/35 §5: per-node stats for one workflow, sortable, with the slowest and
 * flakiest nodes called out so "which node is the problem?" has an answer.
 */
export default function NodeStatsTable({ stats = [] }) {
  const slowest = [...stats].filter((s) => s.p95DurationMs != null).sort((a, b) => b.p95DurationMs - a.p95DurationMs)[0];
  const flakiest = [...stats].filter((s) => s.retryRate > 0 || s.successRate < 1).sort((a, b) => (b.retryRate - a.retryRate) || (a.successRate - b.successRate))[0];

  const columns = [
    {
      key: 'label', header: 'Node', sortable: true,
      cell: (r) => (
        <span className="inline-flex min-w-0 items-center gap-2">
          {r.type && <NodeTypeIcon type={r.type} size="sm" />}
          <span className={r.label === '(deleted node)' ? 'italic text-subtle' : 'truncate font-medium text-fg'}>{r.label}</span>
        </span>
      ),
    },
    { key: 'runs', header: 'Runs', align: 'right', sortable: true, className: 'tabular-nums' },
    {
      key: 'successRate', header: 'Success', align: 'right', sortable: true, className: 'tabular-nums',
      cell: (r) => <span className={r.successRate != null && r.successRate < 0.9 ? 'text-danger' : ''}>{num(r.successRate, formatPercent)}</span>,
    },
    { key: 'avgDurationMs', header: 'Avg', align: 'right', sortable: true, className: 'tabular-nums', cell: (r) => num(r.avgDurationMs, formatDuration) },
    { key: 'p95DurationMs', header: 'p95', align: 'right', sortable: true, className: 'tabular-nums', cell: (r) => num(r.p95DurationMs, formatDuration) },
    { key: 'retryRate', header: 'Retry rate', align: 'right', sortable: true, className: 'tabular-nums', cell: (r) => num(r.retryRate, formatPercent) },
    { key: 'avgAttempts', header: 'Avg attempts', align: 'right', sortable: true, className: 'tabular-nums', cell: (r) => num(r.avgAttempts, (v) => v.toFixed(2)) },
    { key: 'cacheHitRate', header: 'Cache hits', align: 'right', sortable: true, className: 'tabular-nums', cell: (r) => num(r.cacheHitRate, formatPercent) },
    { key: 'handledFailures', header: 'Handled', align: 'right', sortable: true, className: 'tabular-nums' },
  ];

  return (
    <div>
      {(slowest || flakiest) && (
        <div className="mb-3 flex flex-wrap gap-2">
          {slowest && <Badge tone="warning" icon={Gauge}>Slowest: <strong className="font-semibold">{slowest.label}</strong> · p95 {formatDuration(slowest.p95DurationMs)}</Badge>}
          {flakiest && <Badge tone="danger" icon={TriangleAlert}>Flakiest: <strong className="font-semibold">{flakiest.label}</strong> · retries {formatPercent(flakiest.retryRate)} · success {formatPercent(flakiest.successRate)}</Badge>}
        </div>
      )}
      <DataTable
        dense
        columns={columns}
        rows={stats}
        rowKey={(r) => r.nodeId}
        initialSort={{ key: 'p95DurationMs', dir: 'desc' }}
        empty={{ icon: Boxes, title: 'No node executions in this range yet', compact: true }}
      />
    </div>
  );
}
