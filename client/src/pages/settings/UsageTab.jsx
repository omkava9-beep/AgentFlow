import { useCallback, useEffect, useState } from 'react';
import { getUsage, listPlans, changePlan } from '../../api/usage';
import { apiErrorMessage } from '../../api/client';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useToastStore } from '../../store/toastStore';
import { useCan } from '../../hooks/useCan';
import { on } from '../../realtime/socket';
import { Activity, Boxes, Check, Cpu, Database, Gauge, Sparkles, Zap } from 'lucide-react';
import { Badge, Button, StatTile, Skeleton, confirm, cx } from '../../components/ui/index';
import ChartCard from '../../components/charts/ChartCard';
import RunsOverTime from '../../components/charts/RunsOverTime';
import SettingsCard from './SettingsCard';
import { formatDuration, formatPercent } from '../../utils/format';

const RANGE_DAYS = 30;
const fmt = (n) => (n == null ? 'Unlimited' : n.toLocaleString());

/** One limit as a labelled meter: used / limit, with the fill as reinforcement. */
function Meter({ label, used, limit, hint, icon: Icon }) {
  const share = limit ? Math.min(used / limit, 1) : 0;
  const full = limit != null && used >= limit;
  const near = limit != null && share >= 0.8 && !full;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5 font-medium text-fg">
          {Icon && <Icon className="h-3.5 w-3.5 text-subtle" aria-hidden="true" />}
          {label}
        </span>
        <span className="tabular-nums text-muted">
          {used.toLocaleString()} <span className="text-subtle">/ {fmt(limit)}</span>
        </span>
      </div>
      <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle" role="meter" aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit ?? undefined} aria-label={label}>
        <span
          className={cx('block h-full rounded-full transition-[width]', full ? 'bg-danger' : near ? 'bg-warning' : 'bg-accent')}
          style={{ width: `${limit == null ? 0 : Math.max(share * 100, used > 0 ? 2 : 0)}%` }}
        />
      </span>
      {hint && <p className="mt-1.5 text-xs text-subtle">{hint}</p>}
    </div>
  );
}

const PLAN_ICON = { free: Sparkles, team: Boxes, enterprise: Cpu };

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
  const [busy, setBusy] = useState(null); // plan id being switched to

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

  async function switchPlan(target) {
    const ok = await confirm({
      title: `Switch to the ${target.name} plan?`,
      body: `${current.name} gets the ${target.name} limits immediately. Plans are simulated — no payment is taken, and running jobs are never stopped.`,
      confirmLabel: `Switch to ${target.name}`,
    });
    if (!ok) return;
    setBusy(target.id);
    try {
      const updated = await changePlan(current.id, target.id);
      const store = useWorkspaceStore.getState();
      const merged = { ...current, ...updated };
      store.upsertWorkspace(merged);
      store.setCurrent(merged);
      push(`Switched to the ${target.name} plan`, 'success');
      load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not change the plan'));
    } finally {
      setBusy(null);
    }
  }

  if (!current) return null;
  if (error && !usage) return <p className="text-sm text-danger" role="alert">{error}</p>;
  if (!usage) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-44 w-full rounded-card" />
        <div className="grid gap-3 md:grid-cols-3"><Skeleton className="h-32 rounded-card" /><Skeleton className="h-32 rounded-card" /><Skeleton className="h-32 rounded-card" /></div>
      </div>
    );
  }

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
      <SettingsCard
        title={(
          <span className="flex items-center gap-2">
            {plan.name} plan <Badge tone="accent" size="xs">Current</Badge>
          </span>
        )}
        description={`${fmt(limits.runsPerDay)} runs a day · ${limits.concurrencyCap} concurrent jobs · ${fmt(limits.members)} members. Plans are simulated — they set this workspace's limits, and no payment is ever taken.`}
      >
        <div className="grid gap-6 md:grid-cols-3">
          <Meter
            label="Runs today"
            icon={Activity}
            used={today.runs}
            limit={limits.runsPerDay}
            hint={`Resets ${resetAt.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`}
          />
          <Meter
            label="Concurrency"
            icon={Gauge}
            used={live.active}
            limit={live.cap}
            hint={`${live.queued} queued · shared pool of ${live.concurrency}${live.poolSaturated ? ' · server busy' : ''}`}
          />
          <Meter label="Members" icon={Boxes} used={members.used} limit={members.limit} hint="Includes pending invites" />
        </div>
      </SettingsCard>

      {plans.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-fg">Plans</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {plans.map((p) => {
              const isCurrent = p.id === plan.id;
              const Icon = PLAN_ICON[p.id] || Boxes;
              return (
                <div
                  key={p.id}
                  className={cx('flex flex-col rounded-card border bg-surface p-4', isCurrent ? 'border-accent ring-1 ring-accent/30' : 'border-default')}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-semibold text-fg">
                      <Icon className="h-4 w-4 text-subtle" aria-hidden="true" /> {p.name}
                    </span>
                    {isCurrent && <Badge tone="accent" size="xs">Current plan</Badge>}
                  </div>
                  <ul className="mt-3 flex-1 space-y-1.5 text-sm text-muted">
                    {[`${fmt(p.runsPerDay)} runs / day`, `${p.concurrencyCap} concurrent jobs`, `${fmt(p.members)} members`].map((line) => (
                      <li key={line} className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-success" aria-hidden="true" /> {line}</li>
                    ))}
                  </ul>
                  <div className="mt-4">
                    {isCurrent ? (
                      <span className="text-xs text-subtle">You&rsquo;re on this plan</span>
                    ) : canBill ? (
                      <Button variant="secondary" size="sm" className="w-full" loading={busy === p.id} onClick={() => switchPlan(p)}>
                        Switch to {p.name}
                      </Button>
                    ) : (
                      <span className="text-xs text-subtle">Only owners can change the plan</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
        </section>
      )}

      <ChartCard title="Runs per day" subtitle={`Last ${RANGE_DAYS} days`}>
        <RunsOverTime data={runsSeries} rangeDays={RANGE_DAYS} />
      </ChartCard>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Node executions" icon={Zap} value={totals.nodeExecutions.toLocaleString()} hint={`Last ${RANGE_DAYS} days`} />
        <StatTile
          label="Integration calls"
          icon={Boxes}
          value={(totals.live + totals.sandbox).toLocaleString()}
          hint={`${totals.live.toLocaleString()} live · ${totals.sandbox.toLocaleString()} sandbox`}
        />
        <StatTile
          label="Agent calls"
          icon={Sparkles}
          value={(totals.mock + totals.llm).toLocaleString()}
          hint={`${totals.mock.toLocaleString()} mock · ${totals.llm.toLocaleString()} LLM · ${totals.mcp.toLocaleString()} MCP`}
        />
        <StatTile
          label="Cache hit rate"
          icon={Database}
          value={lookups ? formatPercent(totals.hits / lookups) : '—'}
          hint={`Avg queue wait ${totals.nodeExecutions ? formatDuration(Math.round(totals.waitMs / totals.nodeExecutions)) : '—'}`}
        />
      </div>
    </div>
  );
}
