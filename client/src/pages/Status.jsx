import { useCallback, useEffect, useState } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { getWorkspaceStatus, getGlobalStatus } from '../api/status';
import { me } from '../api/auth';
import { on } from '../realtime/socket';
import { Card } from '../components/ui';
import { SkeletonGrid } from '../components/ui/Skeleton';
import { apiErrorMessage } from '../api/client';

const REFRESH_MS = 5000;

function Dot({ tone }) {
  const tones = { good: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500', idle: 'bg-slate-400' };
  return <span className={`inline-block h-2 w-2 rounded-full ${tones[tone] || tones.idle}`} />;
}

function Section({ title, children, right = null }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h2>
        {right}
      </div>
      {children}
    </Card>
  );
}

function Stat({ label, value, hint = null }) {
  return (
    <div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value}</div>
      {hint && <div className="text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

/**
 * spec/36 §7: the workspace-scoped status page. Every member sees only this
 * workspace's slice of the shared queue, cache, cron registry and sockets;
 * operators (OPERATOR_EMAILS) also get a Global toggle.
 */
export default function Status() {
  const current = useWorkspaceStore((s) => s.current);
  const [data, setData] = useState(null);
  const [global, setGlobal] = useState(null);
  const [operator, setOperator] = useState(false);
  const [view, setView] = useState('workspace');
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!current?.id) return;
    try {
      if (view === 'global') setGlobal(await getGlobalStatus());
      else setData(await getWorkspaceStatus(current.id));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load status'));
    }
  }, [current?.id, view]);

  useEffect(() => {
    me().then((u) => setOperator(Boolean(u?.operator))).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // The queue section also updates live between polls (spec/36 §7).
  useEffect(() => on('queue:stats', (s) => {
    if (s?.workspaceId === current?.id) setData((d) => (d ? { ...d, queue: { ...d.queue, ...s } } : d));
  }), [current?.id]);

  const toggle = operator && (
    <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs dark:border-slate-700">
      {['workspace', 'global'].map((v) => (
        <button
          key={v}
          onClick={() => setView(v)}
          className={`rounded-md px-3 py-1 capitalize ${view === v ? 'bg-brand-500 text-white' : 'text-slate-600 dark:text-slate-300'}`}
        >
          {v === 'workspace' ? current?.name || 'Workspace' : 'Global'}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">System status</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {view === 'global' ? 'Every tenant on this server (operator view).' : `What ${current?.name || 'this workspace'} is using of the shared server.`} Refreshes every 5 s.
          </p>
        </div>
        {toggle}
      </div>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {view === 'global' ? <GlobalView data={global} /> : <WorkspaceView data={data} />}
    </div>
  );
}

function WorkspaceView({ data }) {
  if (!data) return <SkeletonGrid count={6} />;
  const { mongo, modes, queue, runs, cache, cron, rss, realtime, mcp, api } = data;
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Section title="Health">
        <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-200">
          <li className="flex items-center gap-2"><Dot tone="good" /> API up · {Math.round(api.uptimeSec / 60)} min</li>
          <li className="flex items-center gap-2"><Dot tone={mongo.status === 'up' ? 'good' : 'bad'} /> MongoDB {mongo.status}{mongo.pingMs != null && ` · ${mongo.pingMs} ms`}</li>
          <li className="flex items-center gap-2"><Dot tone={modes.integrationsLive ? 'good' : 'warn'} /> Integrations {modes.integrationsLive ? 'live' : 'sandbox only'}</li>
          <li className="flex items-center gap-2"><Dot tone="idle" /> Agent provider: {modes.agentProvider}</li>
        </ul>
      </Section>
      <Section title="Queue" right={queue.poolSaturated && <span className="text-xs font-medium text-amber-600">shared pool busy</span>}>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Running" value={`${queue.active} / ${queue.cap}`} hint="your plan's cap" />
          <Stat label="Queued" value={queue.queued} />
          <Stat label="Pool" value={queue.concurrency} hint="shared slots" />
        </div>
        <div className="mt-3 text-xs text-slate-500">Runs: {runs.running} running · {runs.waiting} waiting · {runs.pending} pending</div>
      </Section>
      <Section title="Cache">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Entries" value={cache.entries} />
          <Stat label="Hit rate today" value={pct(cache.hitRate)} />
          <Stat label="Hits / misses" value={`${cache.hitsToday} / ${cache.missesToday}`} />
        </div>
      </Section>
      <Section title="Schedules">
        {cron.schedules.length ? (
          <ul className="space-y-1 text-sm">
            {cron.schedules.map((s) => (
              <li key={s.workflowId} className="flex justify-between gap-2"><span className="truncate">{s.name}</span><span className="text-slate-500">{fmtTime(s.nextRun)}</span></li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">No schedules registered in this process.</p>}
        {rss.connections.length > 0 && (
          <div className="mt-3 border-t border-slate-200 pt-2 text-xs text-slate-500 dark:border-slate-800">
            RSS poller {rss.pollerRunning ? 'running' : 'stopped'} · {rss.connections.map((c) => `${c.name}: ${c.lastPolledAt ? fmtTime(c.lastPolledAt) : 'not polled yet'}`).join(' · ')}
          </div>
        )}
      </Section>
      <Section title="Realtime">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Sockets" value={realtime.sockets} />
          <Stat label="Online members" value={realtime.online.length} hint={realtime.online.map((u) => u.name).join(', ') || null} />
        </div>
        <div className="mt-3 text-xs text-slate-500">
          {realtime.collabSessions.length
            ? realtime.collabSessions.map((s) => `${s.name} (${s.editors} editing)`).join(' · ')
            : 'No live editing sessions.'}
        </div>
      </Section>
      <Section title="MCP servers">
        {mcp.length ? (
          <ul className="space-y-1 text-sm">
            {mcp.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 truncate"><Dot tone={c.state === 'connected' ? 'good' : c.state === 'error' ? 'bad' : 'idle'} />{c.name}</span>
                <span className="text-xs text-slate-500">{c.transport} · {c.state}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">No MCP connections.</p>}
      </Section>
    </div>
  );
}

function GlobalView({ data }) {
  if (!data) return <SkeletonGrid count={3} />;
  const { queue, memory, uptimeSec, cache, cron, realtime, mcp, mongo } = data;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Section title="Server">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Uptime" value={`${Math.round(uptimeSec / 60)} min`} />
          <Stat label="Memory" value={`${memory.rssMb} MB`} hint={`heap ${memory.heapUsedMb} MB`} />
          <Stat label="MongoDB" value={mongo.status} />
          <Stat label="Sockets" value={realtime.sockets} />
          <Stat label="Cache entries" value={cache.entries} />
          <Stat label="Schedules" value={cron.schedules} />
          <Stat label="Collab sessions" value={realtime.collabSessions} />
          <Stat label="MCP clients" value={mcp.pooledClients} />
        </div>
      </Section>
      <Section title="Queue by workspace" right={<span className="text-xs text-slate-500">{queue.active} / {queue.concurrency} slots · {queue.queued} queued</span>}>
        {queue.perWorkspace.length ? (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Workspace</th><th>Plan</th><th className="text-right">Running</th><th className="text-right">Queued</th><th className="text-right">Cap</th></tr></thead>
            <tbody>
              {queue.perWorkspace.map((w) => (
                <tr key={w.workspaceId} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1">{w.name}</td><td>{w.plan || '—'}</td>
                  <td className="text-right tabular-nums">{w.active}</td><td className="text-right tabular-nums">{w.queued}</td><td className="text-right tabular-nums">{w.cap}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-sm text-slate-500">The queue is idle.</p>}
      </Section>
    </div>
  );
}
