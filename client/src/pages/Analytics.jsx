import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAnalyticsSummary } from '../api/analytics';
import { apiErrorMessage } from '../api/client';
import { Card, ErrorText } from '../components/ui';
import ChartCard from '../components/charts/ChartCard';
import StatTile from '../components/charts/StatTile';
import RunsOverTime from '../components/charts/RunsOverTime';
import CategoryBars from '../components/charts/CategoryBars';
import OutcomeMeters from '../components/charts/OutcomeMeters';
import DataTable from '../components/charts/DataTable';
import { formatDayLong, formatDuration, formatPercent } from '../utils/format';

const RANGES = [7, 30, 90];
const TRIGGER_LABELS = { manual: 'Manual', schedule: 'Scheduled', webhook: 'Webhook', event: 'Event' };

export default function Analytics() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    setLoading(true);
    getAnalyticsSummary(days)
      .then(setData)
      .catch((err) => setError(apiErrorMessage(err, 'Failed to load analytics')))
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Analytics</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Your run history, aggregated. Dates are bucketed in UTC.
          </p>
        </div>

        {/* Filters sit in one row above the charts. */}
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setDays(r)}
              aria-pressed={days === r}
              className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                days === r
                  ? 'bg-gradient-to-br from-brand-500 to-purple-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      <ErrorText>{error}</ErrorText>

      {loading && !data ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading...</p>
      ) : !data ? null : data.totalRuns === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-slate-600 dark:text-slate-300">No runs in the last {days} days.</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Run a workflow to see analytics here — try the{' '}
            <Link to="/templates" className="text-brand-600 hover:underline dark:text-brand-400">
              templates gallery
            </Link>{' '}
            for something ready to execute.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Total runs" value={data.totalRuns} hint={`Last ${data.rangeDays} days`} />
            <StatTile
              label="Success rate"
              value={formatPercent(data.successRate)}
              hint={`${data.statusBreakdown.success} of ${
                data.statusBreakdown.success + data.statusBreakdown.failed + data.statusBreakdown.cancelled
              } finished`}
            />
            <StatTile label="Avg duration" value={formatDuration(data.avgDurationMs)} hint="Per completed run" />
            <StatTile label="Median duration" value={formatDuration(data.medianDurationMs)} hint="Less skewed by outliers" />
          </div>

          <ChartCard
            title="Runs over time"
            subtitle={`Runs started per day over the last ${data.rangeDays} days`}
            action={
              <button
                onClick={() => setShowTable((v) => !v)}
                className="rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {showTable ? 'Show chart' : 'Show data'}
              </button>
            }
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
              <CategoryBars
                data={data.runsByTrigger.map((t) => ({ label: TRIGGER_LABELS[t.trigger] || t.trigger, count: t.count }))}
              />
            </ChartCard>

            <ChartCard title="Node types" subtitle="Across all your workflows">
              <CategoryBars
                data={data.topNodeTypes.map((n) => ({ label: n.type, count: n.count }))}
                emptyMessage="No nodes yet."
              />
            </ChartCard>

            <ChartCard title="Tool types" subtitle="Most-used tools across your workflows">
              <CategoryBars
                data={data.topToolTypes.map((n) => ({ label: n.type, count: n.count }))}
                emptyMessage="No tool nodes configured yet."
              />
            </ChartCard>
          </div>
        </div>
      )}
    </div>
  );
}
