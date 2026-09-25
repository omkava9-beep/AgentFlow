import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BarChart3, Activity, CheckCircle2, Timer, Gauge, Table2, LineChart, LayoutTemplate } from 'lucide-react';
import { getAnalyticsSummary } from '../api/analytics';
import { apiErrorMessage } from '../api/client';
import { PageHeader, StatTile, Combobox, Segmented, Button, EmptyState, Skeleton, Tooltip, cx } from '../components/ui';
import { ErrorText } from '../components/ui.jsx';
import ChartCard from '../components/charts/ChartCard';
import RunsOverTime from '../components/charts/RunsOverTime';
import CategoryBars from '../components/charts/CategoryBars';
import OutcomeMeters from '../components/charts/OutcomeMeters';
import DataTable from '../components/charts/DataTable';
import { formatDayLong, formatDuration, formatPercent } from '../utils/format';
import { useWorkspacePath } from '../hooks/useWorkspacePath';
import { useWorkspaceWorkflows } from '../hooks/useWorkspaceWorkflows';
import { on } from '../realtime/socket';
import NodeStatsTable from '../components/analytics/NodeStatsTable';

// spec/35 §5: a finishing run refetches the summary - debounced, so a
// 50-child loop is one refetch, not fifty.
const LIVE_DEBOUNCE_MS = 2000;

const RANGES = [7, 30, 90];
const TRIGGER_LABELS = { manual: 'Manual', schedule: 'Scheduled', webhook: 'Webhook', event: 'Event', api: 'API', subworkflow: 'Sub-workflow' };
const NODE_LABELS = { subworkflow: 'Sub-workflow' };

function LoadingGrid() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-card" />)}</div>
      <Skeleton className="h-72 rounded-card" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-48 rounded-card" />)}</div>
    </div>
  );
}

export default function Analytics() {
  const wp = useWorkspacePath();
  const navigate = useNavigate();
  // spec/35 §5: /analytics/workflows/:workflowId is the per-workflow view.
  const { workflowId = null } = useParams();
  const { workflows } = useWorkspaceWorkflows();
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showTable, setShowTable] = useState(false);
  const [pulse, setPulse] = useState(false);

  const load = useCallback(() => getAnalyticsSummary(days, workflowId)
    .then((d) => { setData(d); setError(''); })
    .catch((err) => setError(apiErrorMessage(err, 'Failed to load analytics'))), [days, workflowId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  // Live: the aggregation endpoint stays the single source of truth - the
  // server says "something changed", the page asks again.
  const timer = useRef(null);
  useEffect(() => {
    const off = on('run:status_changed', (p) => {
      if (!['success', 'failed', 'cancelled'].includes(p?.status)) return;
      if (workflowId && p.workflowId !== workflowId) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        load().then(() => {
          setPulse(true);
          setTimeout(() => setPulse(false), 1500);
        });
      }, LIVE_DEBOUNCE_MS);
    });
    return () => { off(); clearTimeout(timer.current); };
  }, [load, workflowId]);

  const finished = data ? data.statusBreakdown.success + data.statusBreakdown.failed + data.statusBreakdown.cancelled : 0;
  const workflowName = workflowId ? (data?.workflowName || (workflows || []).find((w) => w._id === workflowId)?.name) : null;

  return (
    <div>
      <PageHeader
        icon={BarChart3}
        title={workflowName ? `${workflowName} · analytics` : 'Analytics'}
        breadcrumbs={workflowId ? [{ label: 'Analytics', to: wp('/analytics') }, { label: workflowName || 'Workflow' }] : undefined}
        meta={(
          <Tooltip content="Updates live as runs finish">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success-subtle px-2 py-0.5 text-2xs font-medium text-success-subtle-fg">
              <span className={cx('h-1.5 w-1.5 rounded-full bg-success', pulse && 'animate-ping')} aria-hidden="true" />
              Live
            </span>
          </Tooltip>
        )}
        description="Your run history, aggregated. Days are bucketed in UTC."
        actions={(
          <div className="flex items-center gap-2">
            <div className="w-60"><Combobox
              size="sm"
              aria-label="Workflow"
              placeholder="All workflows"
              searchPlaceholder="Find a workflow…"
              clearable
              value={workflowId || ''}
              onChange={(v) => navigate(wp(v ? `/analytics/workflows/${v}` : '/analytics'))}
              options={(workflows || []).map((w) => ({ value: w._id, label: w.name }))}
            /></div>
            <Segmented
              aria-label="Range"
              value={String(days)}
              onChange={(v) => setDays(Number(v))}
              items={RANGES.map((r) => ({ value: String(r), label: `${r}d` }))}
            />
          </div>
        )}
      />

      <ErrorText>{error}</ErrorText>

      {loading && !data ? (
        <LoadingGrid />
      ) : !data ? null : data.totalRuns === 0 ? (
        <EmptyState
          icon={BarChart3}
          title={`No runs in the last ${days} days`}
          body="Run a workflow to see analytics here — the templates gallery has workflows that are ready to execute."
          action={<Button icon={LayoutTemplate} onClick={() => navigate(wp('/templates'))}>Browse templates</Button>}
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Total runs" icon={Activity} value={data.totalRuns.toLocaleString()} hint={`Last ${data.rangeDays} days`} />
            <StatTile label="Success rate" icon={CheckCircle2} value={formatPercent(data.successRate)} hint={`${data.statusBreakdown.success} of ${finished} finished`} />
            <StatTile label="Avg duration" icon={Timer} value={formatDuration(data.avgDurationMs)} hint="Per completed run" />
            <StatTile label="Median duration" icon={Gauge} value={formatDuration(data.medianDurationMs)} hint="Less skewed by outliers" />
          </div>

          {data.nodeStats && (
            <ChartCard title="Nodes" subtitle={`Per-node stats for ${data.workflowName} over the last ${data.rangeDays} days`}>
              <NodeStatsTable stats={data.nodeStats} />
            </ChartCard>
          )}

          <ChartCard
            title="Runs over time"
            subtitle={`Runs started per day over the last ${data.rangeDays} days`}
            action={(
              <Button size="xs" variant="ghost" icon={showTable ? LineChart : Table2} onClick={() => setShowTable((v) => !v)}>
                {showTable ? 'Show chart' : 'Show data'}
              </Button>
            )}
          >
            {showTable ? (
              <DataTable
                columns={[
                  { key: 'date', label: 'Date', format: formatDayLong },
                  { key: 'count', label: 'Runs', numeric: true },
                ]}
                rows={data.runsByDay.filter((d) => d.count > 0)}
              />
            ) : (
              <RunsOverTime data={data.runsByDay} rangeDays={data.rangeDays} />
            )}
          </ChartCard>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ChartCard title="Outcomes" subtitle="Share of runs by final status">
              <OutcomeMeters breakdown={data.statusBreakdown} total={data.totalRuns} />
            </ChartCard>

            <ChartCard title="Runs by trigger" subtitle="What started each run">
              <CategoryBars data={data.runsByTrigger.map((t) => ({ label: TRIGGER_LABELS[t.trigger] || t.trigger, count: t.count }))} />
            </ChartCard>

            <ChartCard title="Node types" subtitle={workflowId ? 'In this workflow' : 'Across all your workflows'}>
              <CategoryBars
                data={data.topNodeTypes.map((n) => ({ label: NODE_LABELS[n.type] || n.type.charAt(0).toUpperCase() + n.type.slice(1), count: n.count }))}
                emptyMessage="No nodes yet."
              />
            </ChartCard>

            <ChartCard title="Integrations used" subtitle="Most-used integration actions">
              <CategoryBars
                data={data.topToolTypes.map((n) => ({ label: n.type, count: n.count }))}
                emptyMessage="No integration nodes configured yet."
              />
            </ChartCard>
          </div>
        </div>
      )}
    </div>
  );
}
