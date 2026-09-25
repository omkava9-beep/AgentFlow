import { useCallback, useEffect, useState } from 'react';
import { getUsage, listPlans, changePlan } from '../../api/usage';
import { apiErrorMessage } from '../../api/client';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useToastStore } from '../../store/toastStore';
import { useCan } from '../../hooks/useCan';
import { on } from '../../realtime/socket';
import { Card, Button, ErrorText } from '../../components/ui';
import ChartCard from '../../components/charts/ChartCard';
import RunsOverTime from '../../components/charts/RunsOverTime';
import StatTile from '../../components/charts/StatTile';
import { formatDuration, formatPercent } from '../../utils/format';

const RANGE_DAYS = 30;
const fmt = (n) => (n == null ? 'Unlimited' : n.toLocaleString());

/** One limit as a labelled meter: used / limit, with the fill as reinforcement. */
function Meter({ label, used, limit, hint }) {
  const share = limit ? Math.min(used / limit, 1) : 0;
  const full = limit != null && used >= limit;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-slate-700 dark:text-slate-200">{label}</span>
        <span className="tabular-nums text-slate-500 dark:text-slate-400">
          {used.toLocaleString()} / {fmt(limit)}
        </span>
      </div>
      <span className="mt-1 block h-2 w-full overflow-hidden rounded-sm bg-slate-100 dark:bg-slate-800">
        <span
          className={`block h-full rounded-r-[4px] ${full ? 'bg-amber-500' : 'bg-brand-500'}`}
          style={{ width: `${limit == null ? 0 : share * 100}%` }}
        />
      </span>
      {hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

/**
 * Settings → Usage & plan (spec/33 §7). Visible to every member; only owners
 * see plan changes. Plans are simulated - there is no checkout anywhere.
 */
export default function UsageTab() {
  const current = useWorkspaceStore((s) => s.current);
  const canBill = useCan('workspace:billing');
  const push = useToastStore((s) => s.push);
  const [usage, setUsage] = useState(null);
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(null); // plan id awaiting confirmation
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!current) return;
    getUsage(current.id, RANGE_DAYS)
      .then(setUsage)
      .catch((err) => setError(apiErrorMessage(err, 'Could not load usage')));
  }, [current]);

  useEffect(() => {
    load();
    listPlans().then(setPlans).catch(() => {});
  }, [load]);

  // The live section (cap, running, queued) follows the queue indicator's feed.
  useEffect(() => {
    if (!current) return undefined;
    return on('queue:stats', (stats) => {
      if (stats.workspaceId !== current.id) return;
      setUsage((u) => (u ? { ...u, live: { ...u.live, ...stats } } : u));
    });
  }, [current]);

  async function confirmChange() {
    setBusy(true);
    try {
      const updated = await changePlan(current.id, pending);
      const store = useWorkspaceStore.getState();
      const merged = { ...current, ...updated };
      store.upsertWorkspace(merged);
      store.setCurrent(merged);
      push(`Switched to the ${plans.find((p) => p.id === pending)?.name || pending} plan`);
      setPending(null);
      load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not change the plan'));
    } finally {
      setBusy(false);
    }
  }

  if (!current) return null;
  if (error && !usage) return <ErrorText>{error}</ErrorText>;
  if (!usage) return <p className="text-sm text-slate-500">Loading usage…</p>;

  const { plan, limits, today, members, series, live } = usage;
  const resetAt = new Date(today.resetAt);
  const totals = series.reduce(
    (acc, d) => ({
      nodeExecutions: acc.nodeExecutions + d.nodeExecutions,
      live: acc.live + d.integrationCalls.live,
      sandbox: acc.sandbox + d.integrationCalls.sandbox,
      mcp: acc.mcp + d.mcpCalls,
      mock: acc.mock + d.agentCalls.mock,
      llm: acc.llm + d.agentCalls.llm,
      hits: acc.hits + d.cacheHits,
      misses: acc.misses + d.cacheMisses,
      waitMs: acc.waitMs + d.queueWaitMsTotal,
    }),
    { nodeExecutions: 0, live: 0, sandbox: 0, mcp: 0, mock: 0, llm: 0, hits: 0, misses: 0, waitMs: 0 },
  );
  const lookups = totals.hits + totals.misses;
  const runsSeries = series.map((d) => ({ date: d.day, count: d.runs }));

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Current plan</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">{plan.name}</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {fmt(limits.runsPerDay)} runs a day · {limits.concurrencyCap} concurrent jobs · {fmt(limits.members)} members
            </p>
          </div>
          <p className="max-w-xs text-xs text-slate-400">
            Plans are simulated: they set this workspace&apos;s limits, and no payment is ever taken.
          </p>
        </div>

        <div className="mt-5 grid gap-5 md:grid-cols-3">
          <Meter
            label="Runs today"
            used={today.runs}
            limit={limits.runsPerDay}
            hint={`Resets ${resetAt.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`}
          />
          <Meter
            label="Concurrency"
            used={live.active}
            limit={live.cap}
            hint={`${live.queued} queued · shared pool of ${live.concurrency}${live.poolSaturated ? ' · server busy' : ''}`}
          />
          <Meter label="Members" used={members.used} limit={members.limit} hint="Includes pending invites" />
        </div>
      </Card>

      {(canBill || plans.length > 0) && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">Plans</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {plans.map((p) => {
              const isCurrent = p.id === plan.id;
              return (
                <Card key={p.id} className={`p-4 ${isCurrent ? 'ring-2 ring-brand-500' : ''}`}>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">{p.name}</p>
                  <ul className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                    <li>{fmt(p.runsPerDay)} runs / day</li>
                    <li>{p.concurrencyCap} concurrent jobs</li>
                    <li>{fmt(p.members)} members</li>
                  </ul>
                  <div className="mt-4">
                    {isCurrent ? (
                      <span className="text-xs font-medium text-brand-600 dark:text-brand-300">Current plan</span>
                    ) : canBill ? (
                      <Button variant="secondary" onClick={() => setPending(p.id)}>
                        Switch to {p.name}
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-400">Only owners can change the plan</span>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {pending && (
        <Card className="border-amber-300 p-4 dark:border-amber-700">
          <p className="text-sm text-slate-700 dark:text-slate-200">
            Switch <strong>{current.name}</strong> to the <strong>{plans.find((p) => p.id === pending)?.name}</strong> plan?
            Plans are simulated — no payment is taken. The new limits apply immediately; running jobs are never stopped.
          </p>
          {error && <ErrorText>{error}</ErrorText>}
          <div className="mt-3 flex gap-2">
            <Button onClick={confirmChange} disabled={busy}>{busy ? 'Switching…' : 'Confirm'}</Button>
            <Button variant="ghost" onClick={() => setPending(null)} disabled={busy}>Cancel</Button>
          </div>
        </Card>
      )}

      <ChartCard title="Runs per day" subtitle={`Last ${RANGE_DAYS} days`}>
        <RunsOverTime data={runsSeries} rangeDays={RANGE_DAYS} />
      </ChartCard>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Node executions" value={totals.nodeExecutions.toLocaleString()} hint={`Last ${RANGE_DAYS} days`} />
        <StatTile
          label="Integration calls"
          value={(totals.live + totals.sandbox).toLocaleString()}
          hint={`${totals.live.toLocaleString()} live · ${totals.sandbox.toLocaleString()} sandbox`}
        />
        <StatTile
          label="Agent calls"
          value={(totals.mock + totals.llm).toLocaleString()}
          hint={`${totals.mock.toLocaleString()} mock · ${totals.llm.toLocaleString()} LLM · ${totals.mcp.toLocaleString()} MCP tool calls`}
        />
        <StatTile
          label="Cache hit rate"
          value={lookups ? formatPercent(totals.hits / lookups) : '—'}
          hint={`Avg queue wait ${totals.nodeExecutions ? formatDuration(Math.round(totals.waitMs / totals.nodeExecutions)) : '—'}`}
        />
      </div>
    </div>
  );
}
