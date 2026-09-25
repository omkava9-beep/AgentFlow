import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useIntegrationStore } from '../store/integrationStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useWorkspacePath } from '../hooks/useWorkspacePath';
import { useCan } from '../hooks/useCan';
import { apiClient, apiErrorMessage } from '../api/client';
import { sendTestEvent, pollFeedNow } from '../api/integrationTriggers';
import { findIntegration, groupByCategory, integrationIcon, actionIsLive, CATEGORY_LABELS } from '../utils/integrationCatalog';
import ConnectionDialog from '../components/ConnectionDialog';
import { describeDispatch } from '../utils/dispatchSummary';
import { confirm } from '../components/ui/confirm';
import { useToastStore } from '../store/toastStore';
import { Button, Card, ErrorText, TextField } from '../components/ui';
import { SkeletonGrid } from '../components/ui/Skeleton';

/**
 * The Integrations gallery and each integration's detail page (spec/27 §8).
 * Everything renders from the manifest catalogue (`GET /api/integrations`), so
 * integration number twenty-one needs no change here.
 */

const CATEGORY_TONE = {
  communication: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
  developer: 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
  data: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  productivity: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  commerce: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  web: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  ai: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950/60 dark:text-fuchsia-300',
};
const tone = (category) => CATEGORY_TONE[category] || 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';

function Tile({ integration, size = 'h-9 w-9 text-lg' }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-lg ${size} ${tone(integration.category)}`} aria-hidden>
      {integrationIcon(integration.icon || integration.id)}
    </span>
  );
}

const LiveBadge = () => (
  <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-green-700 dark:bg-green-950/60 dark:text-green-300">Live</span>
);

function useCatalogAndConnections() {
  const { catalog, catalogError, loadCatalog, connections, loadConnections } = useIntegrationStore();
  const workspaceId = useWorkspaceStore((s) => s.current?.id);
  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  useEffect(() => { if (workspaceId) loadConnections(workspaceId, { force: true }); }, [workspaceId, loadConnections]);
  return { catalog, catalogError, connections: connections || [], workspaceId };
}

// ------------------------------------------------------------------ gallery

export default function Integrations() {
  const { id } = useParams();
  return id ? <IntegrationDetail id={id} /> : <Gallery />;
}

function Gallery() {
  const { catalog, catalogError, connections } = useCatalogAndConnections();
  const wp = useWorkspacePath();
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState('');

  const groups = useMemo(
    () => groupByCategory((catalog || []).filter((i) => !category || i.category === category), filter),
    [catalog, filter, category],
  );
  const categories = useMemo(() => [...new Set((catalog || []).map((i) => i.category))], [catalog]);
  const countFor = (integrationId) => connections.filter((c) => c.integration === integrationId).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Integrations</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Every integration works against a per-workspace sandbox; the ones marked Live can call the real service.
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            aria-label="Category"
          >
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>)}
          </select>
          <TextField placeholder="Search integrations…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      </div>

      {catalogError && <ErrorText>{apiErrorMessage(catalogError, 'Could not load the integration catalogue')}</ErrorText>}
      {!catalog && !catalogError && <SkeletonGrid count={6} />}
      {catalog && !groups.length && <Card className="p-8 text-center text-sm text-slate-500">No integration matches “{filter}”.</Card>}

      {groups.map((group) => (
        <section key={group.label}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{group.label}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((integration) => {
              const count = countFor(integration.id);
              return (
                <Link
                  key={integration.id}
                  to={wp(`/integrations/${integration.id}`)}
                  className="group rounded-xl border border-slate-200 bg-white p-4 transition hover:border-brand-400 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-600"
                >
                  <div className="flex items-start gap-3">
                    <Tile integration={integration} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900 dark:text-white">{integration.name}</span>
                        {integration.liveCapable && <LiveBadge />}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                        {integration.id === 'mcp'
                          ? 'Connect any MCP server — its tools become nodes, and agents can call them.'
                          : integration.description}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
                    {integration.dynamicActions ? (
                      <span>tools discovered per server</span>
                    ) : (
                      <span>{integration.actions.length} action{integration.actions.length === 1 ? '' : 's'}</span>
                    )}
                    {integration.triggers?.length > 0 && <span>{integration.triggers.length} trigger{integration.triggers.length === 1 ? '' : 's'}</span>}
                    {count > 0 && <span className="text-brand-600 dark:text-brand-400">{count} connection{count === 1 ? '' : 's'}</span>}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ detail

function Tab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`border-b-2 px-3 py-2 text-sm font-medium transition ${
        active ? 'border-brand-500 text-brand-600 dark:text-brand-400' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  );
}

function IntegrationDetail({ id }) {
  const { catalog, catalogError, connections, workspaceId } = useCatalogAndConnections();
  const loadConnections = useIntegrationStore((s) => s.loadConnections);
  const wp = useWorkspacePath();
  const [tab, setTab] = useState('overview');
  const integration = findIntegration(catalog, id);

  if (catalogError) return <ErrorText>{apiErrorMessage(catalogError, 'Could not load the integration catalogue')}</ErrorText>;
  if (!catalog) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!integration) {
    return (
      <Card className="p-8 text-center text-sm text-slate-500">
        No integration called “{id}”. <Link to={wp('/integrations')} className="text-brand-600 hover:underline">Back to integrations</Link>
      </Card>
    );
  }

  const mine = connections.filter((c) => c.integration === id);
  return (
    <div className="space-y-4">
      <Link to={wp('/integrations')} className="text-sm text-brand-600 hover:underline dark:text-brand-400">← Integrations</Link>
      <div className="flex items-start gap-4">
        <Tile integration={integration} size="h-12 w-12 text-2xl" />
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">{integration.name}</h1>
            {integration.liveCapable && <LiveBadge />}
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">{integration.description}</p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        <Tab active={tab === 'overview'} onClick={() => setTab('overview')}>Overview</Tab>
        <Tab active={tab === 'connections'} onClick={() => setTab('connections')}>Connections ({mine.length})</Tab>
        <Tab active={tab === 'sandbox'} onClick={() => setTab('sandbox')}>Sandbox data</Tab>
        {id === 'knowledge' && <Tab active={false} onClick={() => {}}><Link to={wp('/knowledge')}>Documents ↗</Link></Tab>}
      </div>

      {tab === 'overview' && <Overview integration={integration} connections={mine} />}
      {tab === 'connections' && (
        <ConnectionsTab integration={integration} connections={mine} onChanged={() => loadConnections(workspaceId, { force: true })} />
      )}
      {tab === 'sandbox' && <SandboxTab integration={integration} />}
    </div>
  );
}

function Overview({ integration, connections }) {
  const canTest = useCan('triggers:manage');
  const [results, setResults] = useState({});
  const [connectionId, setConnectionId] = useState('');

  async function test(trigger) {
    setResults((r) => ({ ...r, [trigger.id]: { busy: true } }));
    try {
      const result = await sendTestEvent(integration.id, trigger.id, connectionId || null);
      setResults((r) => ({ ...r, [trigger.id]: { message: describeDispatch(result) } }));
    } catch (err) {
      setResults((r) => ({ ...r, [trigger.id]: { error: apiErrorMessage(err, 'Test event failed') } }));
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Actions</h3>
        {integration.dynamicActions && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Connect any MCP server — a remote one by URL, or a local one your operator has allowlisted. Its tools are
            discovered when you connect, appear as nodes, and can be given to agents. Open a connection to see them.
          </p>
        )}
        <ul className="space-y-3">
          {integration.actions.map((action) => (
            <li key={action.id}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{action.name}</span>
                <span className="font-mono text-[10px] text-slate-400">{integration.id}.{action.id}</span>
                {actionIsLive(action) && <LiveBadge />}
              </div>
              {action.description && <p className="text-xs text-slate-500 dark:text-slate-400">{action.description}</p>}
              {action.outputSample && (
                <pre className="mt-1 max-h-32 overflow-auto rounded bg-slate-100 p-2 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {JSON.stringify(action.outputSample, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Triggers</h3>
        {!integration.triggers?.length && <p className="text-sm text-slate-500">This integration has no triggers.</p>}
        {integration.triggers?.length > 0 && canTest && connections.length > 0 && (
          <label className="mb-3 block text-xs text-slate-500">
            Test events as connection{' '}
            <select value={connectionId} onChange={(e) => setConnectionId(e.target.value)} className="ml-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800">
              <option value="">(none)</option>
              {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <ul className="space-y-3">
          {(integration.triggers || []).map((trigger) => (
            <li key={trigger.id}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{trigger.name}</span>
                  <span className="ml-2 font-mono text-[10px] text-slate-400">{integration.id}.{trigger.id}</span>
                </div>
                {canTest && (
                  <Button variant="secondary" className="!px-2 !py-1 text-xs" disabled={results[trigger.id]?.busy} onClick={() => test(trigger)}>
                    Send test event
                  </Button>
                )}
              </div>
              {trigger.description && <p className="text-xs text-slate-500 dark:text-slate-400">{trigger.description}</p>}
              {results[trigger.id]?.message && <p className="text-xs text-green-600 dark:text-green-400">{results[trigger.id].message}</p>}
              {results[trigger.id]?.error && <p className="text-xs text-red-500">{results[trigger.id].error}</p>}
            </li>
          ))}
        </ul>
        {integration.triggers?.length > 0 && (
          <p className="mt-3 text-[11px] text-slate-400">
            Subscribe a workflow from its Trigger panel → External Event → “From an integration”.
          </p>
        )}
      </Card>
    </div>
  );
}

function ConnectionsTab({ integration, connections, onChanged }) {
  const canManage = useCan('connections:manage');
  const canTrigger = useCan('triggers:manage');
  const [editing, setEditing] = useState(null);
  const [pollState, setPollState] = useState({});

  async function poll(connection) {
    setPollState((s) => ({ ...s, [connection.id]: { busy: true } }));
    try {
      const r = await pollFeedNow(connection.id);
      const message = r.skipped ? `Not polled: ${r.skipped}${r.error ? ` (${r.error})` : ''}`
        : r.firstPoll ? `First poll: recorded ${r.fetched} item(s); new items fire from the next poll.`
          : `${r.fresh} new item(s), ${r.triggered.length} run(s) started.`;
      setPollState((s) => ({ ...s, [connection.id]: { message } }));
    } catch (err) {
      setPollState((s) => ({ ...s, [connection.id]: { error: apiErrorMessage(err, 'Poll failed') } }));
    }
  }

  return (
    <div className="space-y-3">
      {canManage && (
        <Button onClick={() => setEditing({ connection: null })}>+ Connect {integration.name}</Button>
      )}
      {!connections.length && <Card className="p-6 text-center text-sm text-slate-500">No {integration.name} connections in this workspace yet.</Card>}
      {connections.map((c) => (
        <Card key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
          <div>
            <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{c.name}</div>
            <div className="text-xs text-slate-500">
              {c.mode === 'live' ? 'Live' : 'Sandbox'} · {c.status}
              {c.lastError && <span className="text-red-500"> · {c.lastError}</span>}
            </div>
            {pollState[c.id]?.message && <div className="text-xs text-green-600 dark:text-green-400">{pollState[c.id].message}</div>}
            {pollState[c.id]?.error && <div className="text-xs text-red-500">{pollState[c.id].error}</div>}
          </div>
          <div className="flex gap-2">
            {integration.id === 'rss' && canTrigger && (
              <Button variant="secondary" className="!px-2 !py-1 text-xs" disabled={pollState[c.id]?.busy} onClick={() => poll(c)}>Check feed now</Button>
            )}
            {canManage && (
              <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => setEditing({ connection: c })}>
                {integration.hasInbound ? 'Edit · inbound URL' : 'Edit'}
              </Button>
            )}
          </div>
        </Card>
      ))}
      {editing && (
        <ConnectionDialog
          integration={integration}
          connection={editing.connection}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); }}
        />
      )}
    </div>
  );
}

function SandboxTab({ integration }) {
  const [state, setState] = useState({ loading: true });
  const [reloadKey, setReloadKey] = useState(0);
  const [resetting, setResetting] = useState(false);
  const canReset = useCan('connections:manage');
  useEffect(() => {
    let cancelled = false;
    apiClient
      .get(`/integrations/${integration.id}/sandbox`, { params: { limit: 25 } })
      .then(({ data }) => !cancelled && setState({ data }))
      .catch((err) => !cancelled && setState({ error: err?.response?.status === 404 ? 'unavailable' : apiErrorMessage(err, 'Could not load sandbox data') }));
    return () => { cancelled = true; };
  }, [integration.id, reloadKey]);

  async function handleReset() {
    const ok = await confirm({
      title: `Reset the ${integration.name} sandbox?`,
      body: "Deletes everything this workspace's sandbox holds for this integration. Seed data comes back on the next read. Live accounts are never touched.",
      confirmLabel: 'Reset sandbox',
      destructive: true,
    });
    if (!ok) return;
    setResetting(true);
    try {
      const { data } = await apiClient.post(`/integrations/${integration.id}/sandbox/reset`);
      useToastStore.getState().push(`Sandbox reset (${data.deleted} record${data.deleted === 1 ? '' : 's'} removed).`, 'success');
      setReloadKey((k) => k + 1);
    } catch (err) {
      useToastStore.getState().push(apiErrorMessage(err, 'Could not reset the sandbox'), 'error');
    } finally {
      setResetting(false);
    }
  }

  if (state.loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (state.error === 'unavailable') {
    return <Card className="p-6 text-sm text-slate-500">Sandbox data browsing isn't available on this server yet.</Card>;
  }
  if (state.error) return <ErrorText>{state.error}</ErrorText>;
  const { collections = [], records = [] } = state.data || {};
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-slate-500">
          What this workspace's sandbox {integration.name} holds — every sandbox write lands here and later reads see it.
        </p>
        {canReset && collections.length > 0 && (
          <button type="button" onClick={handleReset} disabled={resetting} className="shrink-0 text-xs font-medium text-red-600 hover:underline disabled:opacity-50">
            {resetting ? 'Resetting…' : 'Reset sandbox'}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {collections.map((c) => (
          <span key={c.name} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{c.name} · {c.count}</span>
        ))}
        {!collections.length && <span className="text-sm text-slate-500">Empty — nothing has been written yet.</span>}
      </div>
      {records.length > 0 && (
        <pre className="max-h-96 overflow-auto rounded-lg bg-slate-100 p-3 text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {JSON.stringify(records, null, 2)}
        </pre>
      )}
    </div>
  );
}
