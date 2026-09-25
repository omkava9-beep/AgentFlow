import { useCallback, useEffect, useState } from 'react';
import {
  Activity, Database, Server, Plug, Users, Clock, Gauge, Layers, Radio, Cpu, HardDrive, Rss,
} from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { getWorkspaceStatus, getGlobalStatus } from '../api/status';
import { me } from '../api/auth';
import { on } from '../realtime/socket';
import {
  PageHeader, Card, CardHeader, StatTile, Segmented, DataTable, Badge, SkeletonGrid, EmptyState, AvatarStack, cx,
} from '../components/ui';
import { apiErrorMessage } from '../api/client';
import { RelativeTime } from '../components/runs/RunBits';

const REFRESH_MS = 5000;
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

function HealthRow({ ok, warn, label, detail }) {
  const tone = ok ? 'bg-success' : warn ? 'bg-warning' : 'bg-danger';
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="flex items-center gap-2 text-fg"><span className={cx('h-2 w-2 rounded-full', tone)} aria-hidden="true" />{label}</span>
      <span className="text-xs text-muted">{detail}</span>
    </li>
  );
}

/**
 * spec/36 §7: the workspace-scoped status page. Every member sees only this
 * workspace's slice of the shared queue, cache, cron registry and sockets;
 * operators (OPERATOR_EMAILS) also get a Global view.
 */
export default function Status() {
  const current = useWorkspaceStore((s) => s.current);
  const [data, setData] = useState(null);
  const [global, setGlobal] = useState(null);
  const [operator, setOperator] = useState(false);
  const [view, setView] = useState('workspace');
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    if (!current?.id) return;
    try {
      if (view === 'global') setGlobal(await getGlobalStatus());
      else setData(await getWorkspaceStatus(current.id));
      setError(null);
      setUpdatedAt(new Date());
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load status'));
    }
  }, [current?.id, view]);

  useEffect(() => { me().then((u) => setOperator(Boolean(u?.operator))).catch(() => {}); }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // The queue section also updates live between polls (spec/36 §7).
  useEffect(() => on('queue:stats', (s) => {
    if (s?.workspaceId === current?.id) setData((d) => (d ? { ...d, queue: { ...d.queue, ...s } } : d));
  }), [current?.id]);

  return (
    <div>
      <PageHeader
        icon={Activity}
        title="System status"
        description={view === 'global'
          ? 'Every tenant on this server (operator view).'
          : `What ${current?.name || 'this workspace'} is using of the shared server.`}
        meta={updatedAt && <Badge size="xs" dot tone="success">Updated <RelativeTime value={updatedAt} /></Badge>}
        actions={operator && (
          <Segmented
            aria-label="Scope"
            value={view}
            onChange={setView}
            items={[{ value: 'workspace', label: current?.name || 'Workspace' }, { value: 'global', label: 'Global' }]}
          />
        )}
      />
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      {view === 'global' ? <GlobalView data={global} /> : <WorkspaceView data={data} />}
    </div>
  );
}

function WorkspaceView({ data }) {
  if (!data) return <SkeletonGrid count={6} />;
  const { mongo, modes, queue, runs, cache, cron, rss, realtime, mcp, api } = data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Running jobs" icon={Layers} value={`${queue.active} / ${queue.cap}`} hint={queue.poolSaturated ? 'Shared pool busy' : "Your plan's cap"} />
        <StatTile label="Queued" icon={Clock} value={queue.queued} hint={`${runs.running} running · ${runs.waiting} waiting runs`} />
        <StatTile label="Cache hit rate" icon={Gauge} value={pct(cache.hitRate)} hint={`${cache.hitsToday} hits · ${cache.missesToday} misses today`} />
        <StatTile label="Online members" icon={Users} value={realtime.online.length} hint={`${realtime.sockets} open connection${realtime.sockets === 1 ? '' : 's'}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Health" icon={Server} />
          <ul className="divide-y divide-default px-4 py-1">
            <HealthRow ok label="API" detail={`Up ${Math.round(api.uptimeSec / 60)} min`} />
            <HealthRow ok={mongo.status === 'up'} label="MongoDB" detail={`${mongo.status}${mongo.pingMs != null ? ` · ${mongo.pingMs} ms` : ''}`} />
            <HealthRow ok={modes.integrationsLive} warn label="Integrations" detail={modes.integrationsLive ? 'Live calls enabled' : 'Sandbox only'} />
            <HealthRow ok label="Agent provider" detail={modes.agentProvider} />
          </ul>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Live editing" icon={Radio} description="Who's online and which workflows are being edited right now." />
          <div className="px-4 py-3">
            {realtime.online.length > 0 && (
              <div className="mb-3 flex items-center gap-2 text-sm text-muted">
                <AvatarStack people={realtime.online.map((u) => ({ id: u.id || u.name, name: u.name }))} max={8} />
                <span className="truncate">{realtime.online.map((u) => u.name).join(', ')}</span>
              </div>
            )}
            {realtime.collabSessions.length ? (
              <ul className="space-y-1.5 text-sm">
                {realtime.collabSessions.map((s) => (
                  <li key={s.workflowId || s.name} className="flex items-center justify-between gap-3 rounded-control bg-bg-subtle px-3 py-2">
                    <span className="truncate font-medium text-fg">{s.name}</span>
                    <Badge size="xs" tone="accent">{s.editors} editing</Badge>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-subtle">No live editing sessions.</p>}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg"><Clock className="h-4 w-4 text-subtle" aria-hidden="true" />Schedules</h2>
          <DataTable
            dense
            rowKey={(s) => s.workflowId}
            columns={[
              { key: 'name', header: 'Workflow', cell: (s) => <span className="font-medium">{s.name}</span> },
              { key: 'nextRun', header: 'Next run', align: 'right', cell: (s) => (s.nextRun ? new Date(s.nextRun).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—') },
            ]}
            rows={cron.schedules}
            empty={{ icon: Clock, title: 'No schedules registered', body: 'Enable a schedule trigger on a published workflow.', compact: true }}
          />
          {rss.connections.length > 0 && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <Rss className="h-3.5 w-3.5" aria-hidden="true" />
              RSS poller {rss.pollerRunning ? 'running' : 'stopped'} ·
              {rss.connections.map((c) => (
                <span key={c.name}>{c.name}: {c.lastPolledAt ? <RelativeTime value={c.lastPolledAt} /> : 'not polled yet'}</span>
              ))}
            </p>
          )}
        </section>

        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg"><Plug className="h-4 w-4 text-subtle" aria-hidden="true" />MCP servers</h2>
          <DataTable
            dense
            rowKey={(c) => c.id}
            columns={[
              { key: 'name', header: 'Connection', cell: (c) => <span className="font-medium">{c.name}</span> },
              { key: 'transport', header: 'Transport', cell: (c) => <Badge size="xs">{c.transport}</Badge> },
              {
                key: 'state', header: 'State', align: 'right',
                cell: (c) => <Badge size="xs" dot tone={c.state === 'connected' ? 'success' : c.state === 'error' ? 'danger' : 'neutral'}>{c.state}</Badge>,
              },
            ]}
            rows={mcp}
            empty={{ icon: Plug, title: 'No MCP connections', compact: true }}
          />
        </section>
      </div>
    </div>
  );
}

function GlobalView({ data }) {
  if (!data) return <SkeletonGrid count={4} />;
  const { queue, memory, uptimeSec, cache, cron, realtime, mcp, mongo } = data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Uptime" icon={Server} value={`${Math.round(uptimeSec / 60)} min`} hint={`MongoDB ${mongo.status}`} />
        <StatTile label="Memory" icon={HardDrive} value={`${memory.rssMb} MB`} hint={`Heap ${memory.heapUsedMb} MB`} />
        <StatTile label="Queue" icon={Cpu} value={`${queue.active} / ${queue.concurrency}`} hint={`${queue.queued} queued`} />
        <StatTile label="Sockets" icon={Radio} value={realtime.sockets} hint={`${realtime.collabSessions} collab sessions`} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <StatTile label="Cache entries" icon={Database} value={cache.entries} />
        <StatTile label="Schedules" icon={Clock} value={cron.schedules} />
        <StatTile label="MCP clients" icon={Plug} value={mcp.pooledClients} />
      </div>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-fg">Queue by workspace</h2>
        <DataTable
          dense
          rowKey={(w) => w.workspaceId}
          columns={[
            { key: 'name', header: 'Workspace', cell: (w) => <span className="font-medium">{w.name}</span> },
            { key: 'plan', header: 'Plan', cell: (w) => <Badge size="xs" className="capitalize">{w.plan || '—'}</Badge> },
            { key: 'active', header: 'Running', align: 'right', className: 'tabular-nums' },
            { key: 'queued', header: 'Queued', align: 'right', className: 'tabular-nums' },
            { key: 'cap', header: 'Cap', align: 'right', className: 'tabular-nums' },
          ]}
          rows={queue.perWorkspace}
          empty={<EmptyState compact icon={Layers} title="The queue is idle" />}
        />
      </section>
    </div>
  );
}
