import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight, BookOpen, Blocks, CheckCircle2, Database, FlaskConical, Link2, Plus, Radio, RefreshCw, RotateCcw, Search, Send, Zap,
} from 'lucide-react';
import { useIntegrationStore } from '../store/integrationStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useWorkspacePath } from '../hooks/useWorkspacePath';
import { useCan } from '../hooks/useCan';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { apiClient, apiErrorMessage } from '../api/client';
import { sendTestEvent, pollFeedNow } from '../api/integrationTriggers';
import { testConnection, updateConnection, connectionUsage, deleteConnection } from '../api/connections';
import { findIntegration, actionIsLive, CATEGORY_LABELS } from '../utils/integrationCatalog';
import { describeDispatch } from '../utils/dispatchSummary';
import { formatRelativeTime } from '../utils/time';
import ConnectionDialog from '../components/ConnectionDialog';
import ConnectionsTable from '../components/ConnectionsTable';
import ConnectionDeleteDialog from '../components/ConnectionDeleteDialog';
import { useToastStore } from '../store/toastStore';
import { useBreadcrumb } from '../store/breadcrumbStore';
import {
  PageHeader, Tabs, Card, CardHeader, Badge, Button, Input, Select, IntegrationLogo, EmptyState, SkeletonGrid,
  Drawer, DataTable, IconButton, confirm, prompt, cx,
} from '../components/ui/index';

/**
 * The Integrations gallery and each integration's detail page (spec/27 §8).
 * Everything renders from the manifest catalogue (`GET /api/integrations`), so
 * integration number twenty-one needs no change here.
 */

const toast = (msg, tone) => useToastStore.getState().push(msg, tone);

function useCatalogAndConnections() {
  const { catalog, catalogError, loadCatalog, connections, loadConnections } = useIntegrationStore();
  const workspaceId = useWorkspaceStore((s) => s.current?.id);
  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  useEffect(() => { if (workspaceId) loadConnections(workspaceId, { force: true }); }, [workspaceId, loadConnections]);
  return { catalog, catalogError, connections: connections || [], workspaceId };
}

// Categories the catalogue adds later still read as words, not ids.
const labelFor = (category) => CATEGORY_LABELS[category] || (category ? category[0].toUpperCase() + category.slice(1) : 'Other');

const describe = (integration) => (integration.id === 'mcp'
  ? 'Connect any MCP server — its tools become nodes, and agents can call them.'
  : integration.description);

// ------------------------------------------------------------------ gallery

export default function Integrations() {
  const { id } = useParams();
  return id ? <IntegrationDetail id={id} /> : <Gallery />;
}

function FilterPill({ active, onClick, icon: Icon, children, count }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors',
        active ? 'border-accent/40 bg-accent-subtle text-accent-subtle-fg' : 'border-default bg-surface text-muted hover:border-strong hover:text-fg',
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {children}
      {count != null && <span className="tabular-nums text-subtle">{count}</span>}
    </button>
  );
}

function Gallery() {
  useDocumentTitle('Integrations');
  const { catalog, catalogError, connections } = useCatalogAndConnections();
  const wp = useWorkspacePath();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [liveOnly, setLiveOnly] = useState(false);
  const [connectedOnly, setConnectedOnly] = useState(false);

  const countFor = useCallback((integrationId) => connections.filter((c) => c.integration === integrationId).length, [connections]);
  const categories = useMemo(() => {
    const seen = new Map();
    for (const i of catalog || []) seen.set(i.category, (seen.get(i.category) || 0) + 1);
    return [...seen.entries()].map(([value, count]) => ({ value, count }));
  }, [catalog]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (catalog || []).filter((i) => (category === 'all' || i.category === category)
      && (!liveOnly || i.liveCapable)
      && (!connectedOnly || countFor(i.id) > 0)
      && (!q || `${i.name} ${i.description} ${i.id}`.toLowerCase().includes(q)));
  }, [catalog, category, liveOnly, connectedOnly, query, countFor]);

  const grouped = useMemo(() => {
    if (category !== 'all') return [{ label: labelFor(category), items: visible }];
    const byCat = new Map();
    for (const i of visible) {
      if (!byCat.has(i.category)) byCat.set(i.category, []);
      byCat.get(i.category).push(i);
    }
    return [...byCat.entries()].map(([cat, items]) => ({ label: labelFor(cat), items }));
  }, [visible, category]);

  return (
    <div>
      <PageHeader
        title="Integrations"
        icon={Blocks}
        description="Every integration works against a per-workspace sandbox. The ones marked Live can also call the real service once connected."
        actions={<Button variant="secondary" icon={Link2} onClick={() => navigate(wp('/connections'))}>Manage connections</Button>}
      />

      <div className="mb-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
            <Input placeholder="Search integrations…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" aria-label="Search integrations" />
          </div>
          <div className="flex items-center gap-2">
            <FilterPill active={liveOnly} onClick={() => setLiveOnly((v) => !v)} icon={Radio}>Live-capable</FilterPill>
            <FilterPill active={connectedOnly} onClick={() => setConnectedOnly((v) => !v)} icon={CheckCircle2}>Connected</FilterPill>
          </div>
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Category">
          <FilterPill active={category === 'all'} onClick={() => setCategory('all')} count={(catalog || []).length}>All</FilterPill>
          {categories.map((c) => (
            <FilterPill key={c.value} active={category === c.value} onClick={() => setCategory(c.value)} count={c.count}>
              {labelFor(c.value)}
            </FilterPill>
          ))}
        </div>
      </div>

      {catalogError && <p className="mb-4 text-sm text-danger">{apiErrorMessage(catalogError, 'Could not load the integration catalogue')}</p>}
      {!catalog && !catalogError && <SkeletonGrid count={9} />}
      {catalog && !visible.length && (
        <EmptyState
          icon={Search}
          title="No integrations match"
          body="Try a different search, or clear the filters."
          action={<Button variant="secondary" onClick={() => { setQuery(''); setCategory('all'); setLiveOnly(false); setConnectedOnly(false); }}>Clear filters</Button>}
        />
      )}

      <div className="space-y-8">
        {grouped.map((group) => (
          <section key={group.label}>
            <h2 className="mb-3 text-2xs font-semibold uppercase tracking-wider text-subtle">{group.label}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((integration) => (
                <IntegrationCard key={integration.id} integration={integration} connected={countFor(integration.id)} to={wp(`/integrations/${integration.id}`)} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function IntegrationCard({ integration, connected, to }) {
  const actionCount = integration.dynamicActions ? null : integration.actions.length;
  const triggerCount = integration.triggers?.length || 0;
  return (
    <Link
      to={to}
      className="group flex flex-col rounded-card border border-default bg-surface p-4 transition-colors hover:border-strong hover:bg-bg-subtle/40 focus-visible:border-accent"
    >
      <div className="flex items-start gap-3">
        <IntegrationLogo id={integration.id} name={integration.name} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium text-fg">{integration.name}</span>
            {connected > 0 && (
              <Badge tone="accent" dot size="xs">{connected} connected</Badge>
            )}
          </div>
          <span className="text-xs text-subtle">{labelFor(integration.category)}</span>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm text-muted">{describe(integration)}</p>
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {integration.liveCapable
          ? <Badge tone="success" icon={Radio} size="xs">Live</Badge>
          : <Badge tone="neutral" icon={FlaskConical} size="xs">Sandbox only</Badge>}
        {actionCount == null
          ? <Badge tone="neutral" size="xs">Tools discovered per server</Badge>
          : <Badge tone="neutral" size="xs">{actionCount} action{actionCount === 1 ? '' : 's'}</Badge>}
        {triggerCount > 0 && <Badge tone="info" icon={Zap} size="xs">{triggerCount} trigger{triggerCount === 1 ? '' : 's'}</Badge>}
        <ArrowRight className="ml-auto h-4 w-4 text-subtle opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
      </div>
    </Link>
  );
}

// ------------------------------------------------------------------ detail

function IntegrationDetail({ id }) {
  const { catalog, catalogError, connections, workspaceId } = useCatalogAndConnections();
  const loadConnections = useIntegrationStore((s) => s.loadConnections);
  const wp = useWorkspacePath();
  const canManage = useCan('connections:manage');
  const [tab, setTab] = useState('overview');
  const [creating, setCreating] = useState(false);
  const integration = findIntegration(catalog, id);
  useDocumentTitle(integration?.name || 'Integration');
  useBreadcrumb(integration?.name);
  const refresh = useCallback(() => loadConnections(workspaceId, { force: true }), [loadConnections, workspaceId]);

  if (catalogError) return <p className="text-sm text-danger">{apiErrorMessage(catalogError, 'Could not load the integration catalogue')}</p>;
  if (!catalog) return <SkeletonGrid count={2} className="grid gap-4 lg:grid-cols-2" />;
  if (!integration) {
    return (
      <EmptyState
        icon={Blocks}
        title={`No integration called “${id}”`}
        body="It may have been removed from this server's catalogue."
        action={<Link to={wp('/integrations')}><Button variant="secondary">Back to integrations</Button></Link>}
      />
    );
  }

  const mine = connections.filter((c) => c.integration === id);
  const Logo = () => <IntegrationLogo id={integration.id} name={integration.name} size="md" />;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: '← All integrations', to: wp('/integrations') }]}
        title={integration.name}
        icon={Logo}
        description={describe(integration)}
        meta={(
          <>
            {integration.liveCapable
              ? <Badge tone="success" icon={Radio}>Live-capable</Badge>
              : <Badge tone="neutral" icon={FlaskConical}>Sandbox only</Badge>}
            <Badge tone="neutral">{labelFor(integration.category)}</Badge>
          </>
        )}
        actions={(
          <>
            {id === 'knowledge' && <Link to={wp('/knowledge')}><Button variant="secondary" icon={BookOpen}>Documents</Button></Link>}
            {canManage && <Button icon={Plus} onClick={() => setCreating(true)}>Connect {integration.name}</Button>}
          </>
        )}
        tabs={(
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { value: 'overview', label: 'Overview' },
              { value: 'connections', label: 'Connections', count: mine.length },
              { value: 'sandbox', label: 'Sandbox data', icon: Database },
            ]}
          />
        )}
      />

      {tab === 'overview' && <Overview integration={integration} connections={mine} onConnect={canManage ? () => setCreating(true) : null} />}
      {tab === 'connections' && <ConnectionsTab integration={integration} connections={mine} onChanged={refresh} onConnect={() => setCreating(true)} />}
      {tab === 'sandbox' && <SandboxTab integration={integration} />}

      {creating && (
        <ConnectionDialog
          integration={integration}
          connection={null}
          onClose={() => setCreating(false)}
          onSaved={() => { refresh(); }}
        />
      )}
    </div>
  );
}

function Overview({ integration, connections, onConnect }) {
  const canTest = useCan('triggers:manage');
  const [results, setResults] = useState({});
  const [connectionId, setConnectionId] = useState('');
  const [openSample, setOpenSample] = useState(null);

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
    <div className="grid items-start gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader
          title="Actions"
          description={integration.dynamicActions ? 'Discovered from each connected server' : `${integration.actions.length} things a workflow node can do`}
        />
        {integration.dynamicActions ? (
          <div className="p-4 text-sm text-muted">
            Connect any MCP server — a remote one by URL, or a local one your operator has allowlisted. Its tools are
            discovered when you connect, appear as nodes, and can be given to agents. Open a connection to see them.
            {onConnect && <div className="mt-3"><Button size="sm" icon={Plus} onClick={onConnect}>Connect a server</Button></div>}
          </div>
        ) : (
          <ul className="divide-y divide-default">
            {integration.actions.map((action) => (
              <li key={action.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-fg">{action.name}</span>
                  <code className="font-mono text-2xs text-subtle">{integration.id}.{action.id}</code>
                  {actionIsLive(action) ? <Badge tone="success" size="xs">Live</Badge> : <Badge tone="neutral" size="xs">Sandbox</Badge>}
                  {action.sideEffect && <Badge tone="warning" size="xs">Side effect</Badge>}
                  {action.outputSample && (
                    <button
                      type="button"
                      onClick={() => setOpenSample(openSample === action.id ? null : action.id)}
                      className="ml-auto text-xs font-medium text-accent hover:underline"
                      aria-expanded={openSample === action.id}
                    >
                      {openSample === action.id ? 'Hide output' : 'Sample output'}
                    </button>
                  )}
                </div>
                {action.description && <p className="mt-0.5 text-sm text-muted">{action.description}</p>}
                {openSample === action.id && (
                  <pre className="mt-2 max-h-48 overflow-auto rounded-control border border-default bg-surface-sunken p-3 font-mono text-2xs text-muted">
                    {JSON.stringify(action.outputSample, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader title="Triggers" description={integration.triggers?.length ? 'Events that can start a workflow' : undefined} />
          {!integration.triggers?.length ? (
            <p className="p-4 text-sm text-muted">This integration has no triggers.</p>
          ) : (
            <>
              {canTest && connections.length > 0 && (
                <div className="border-b border-default px-4 py-3">
                  <label className="mb-1.5 block text-xs font-medium text-muted" htmlFor="test-as-connection">Send test events as</label>
                  <Select
                    id="test-as-connection"
                    size="sm"
                    value={connectionId}
                    onValueChange={setConnectionId}
                    options={[{ value: '', label: 'No connection' }, ...connections.map((c) => ({ value: c.id, label: c.name }))]}
                  />
                </div>
              )}
              <ul className="divide-y divide-default">
                {integration.triggers.map((trigger) => (
                  <li key={trigger.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-fg">{trigger.name}</div>
                        <code className="font-mono text-2xs text-subtle">{integration.id}.{trigger.id}</code>
                      </div>
                      {canTest && (
                        <Button variant="secondary" size="xs" icon={Send} loading={results[trigger.id]?.busy} onClick={() => test(trigger)}>
                          Send test event
                        </Button>
                      )}
                    </div>
                    {trigger.description && <p className="mt-1 text-sm text-muted">{trigger.description}</p>}
                    {results[trigger.id]?.message && <p className="mt-1.5 text-xs text-success">{results[trigger.id].message}</p>}
                    {results[trigger.id]?.error && <p className="mt-1.5 text-xs text-danger">{results[trigger.id].error}</p>}
                  </li>
                ))}
              </ul>
              <p className="border-t border-default px-4 py-2.5 text-xs text-subtle">
                Subscribe a workflow from its Trigger panel → External Event → “From an integration”.
              </p>
            </>
          )}
        </Card>

        <Card padded>
          <h3 className="text-sm font-semibold text-fg">How it runs</h3>
          <ul className="mt-2 space-y-2 text-sm text-muted">
            <li className="flex gap-2"><FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
              Without a live connection, actions run against this workspace&rsquo;s sandbox — realistic data, nothing sent.</li>
            {integration.liveCapable && (
              <li className="flex gap-2"><Radio className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                With a connection in Live mode, calls go to the real {integration.name} through the outbound guard.</li>
            )}
            {integration.hasInbound && (
              <li className="flex gap-2"><Link2 className="mt-0.5 h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
                Each connection gets an inbound webhook URL so {integration.name}&rsquo;s events can start workflows.</li>
            )}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function ConnectionsTab({ integration, connections, onChanged, onConnect }) {
  const canManage = useCan('connections:manage');
  const canUse = useCan('connections:use');
  const canTrigger = useCan('triggers:manage');
  const catalog = useIntegrationStore((s) => s.catalog);
  const [editing, setEditing] = useState(null);
  const [testing, setTesting] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  async function poll(connection) {
    try {
      const r = await pollFeedNow(connection.id);
      const message = r.skipped ? `Not polled: ${r.skipped}${r.error ? ` (${r.error})` : ''}`
        : r.firstPoll ? `First poll: recorded ${r.fetched} item(s); new items fire from the next poll.`
          : `${r.fresh} new item(s), ${r.triggered.length} run(s) started.`;
      toast(message, r.skipped ? 'info' : 'success');
    } catch (err) {
      toast(apiErrorMessage(err, 'Poll failed'), 'error');
    }
  }

  async function runTest(connection) {
    setTesting(connection.id);
    try {
      const result = await testConnection(connection.id);
      toast(result.status === 'ok' ? `${connection.name} works` : `${connection.name}: ${result.lastError || 'test failed'}`, result.status === 'ok' ? 'success' : 'error');
      onChanged();
    } catch (err) {
      toast(apiErrorMessage(err, 'Test failed'), 'error');
    } finally {
      setTesting(null);
    }
  }

  async function rename(connection) {
    const name = await prompt({ title: 'Rename connection', label: 'Name', defaultValue: connection.name });
    if (!name || name.trim() === connection.name) return;
    try { await updateConnection(connection.id, { name: name.trim() }); onChanged(); } catch (err) { toast(apiErrorMessage(err, 'Rename failed'), 'error'); }
  }

  async function startDelete(connection) {
    setDeleteError('');
    const usage = await connectionUsage(connection.id).catch(() => []);
    setDeleting({ connection, usage: Array.isArray(usage) ? usage : [] });
  }

  async function confirmDelete(force) {
    setDeleteBusy(true);
    try {
      await deleteConnection(deleting.connection.id, { force });
      setDeleting(null);
      onChanged();
    } catch (err) {
      if (err?.response?.status === 409) {
        setDeleting((d) => ({ ...d, usage: err.response.data?.usage || [] }));
        setDeleteError('This connection is in use — review the list and confirm.');
      } else setDeleteError(apiErrorMessage(err, 'Failed to delete connection'));
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div>
      <ConnectionsTable
        connections={connections}
        catalog={catalog}
        busyId={testing}
        canManage={canManage}
        canUse={canUse}
        hideIntegration
        onEdit={(c) => setEditing({ connection: c })}
        onTest={runTest}
        onRename={rename}
        onDelete={startDelete}
        onPoll={canTrigger ? poll : undefined}
        empty={{
          icon: Link2,
          title: `No ${integration.name} connections yet`,
          body: integration.auth?.type === 'none'
            ? `${integration.name} needs no credentials — nodes work without a connection. Add one to set a default mode or an inbound URL.`
            : `Add one to store ${integration.name} credentials (encrypted) so nodes can call it live.`,
          action: canManage ? <Button icon={Plus} onClick={onConnect}>Connect {integration.name}</Button> : null,
        }}
      />
      {editing && (
        <ConnectionDialog
          integration={integration}
          connection={editing.connection}
          onClose={() => setEditing(null)}
          onSaved={() => onChanged()}
        />
      )}
      {deleting && (
        <ConnectionDeleteDialog
          connection={deleting.connection}
          usage={deleting.usage}
          busy={deleteBusy}
          error={deleteError}
          onClose={() => setDeleting(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

function docPreview(doc) {
  if (!doc || typeof doc !== 'object') return String(doc ?? '');
  const entries = Object.entries(doc).filter(([k]) => !k.startsWith('_')).slice(0, 4);
  return entries.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
}

function SandboxTab({ integration }) {
  const [state, setState] = useState({ loading: true });
  const [reloadKey, setReloadKey] = useState(0);
  const [resetting, setResetting] = useState(false);
  const [collection, setCollection] = useState('all');
  const [open, setOpen] = useState(null);
  const canReset = useCan('connections:manage');

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    apiClient
      .get(`/integrations/${integration.id}/sandbox`, { params: { limit: 100 } })
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
      toast(`Sandbox reset (${data.deleted} record${data.deleted === 1 ? '' : 's'} removed).`, 'success');
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast(apiErrorMessage(err, 'Could not reset the sandbox'), 'error');
    } finally {
      setResetting(false);
    }
  }

  if (state.error === 'unavailable') {
    return <EmptyState icon={Database} title="Sandbox browsing isn't available" body="This server doesn't expose sandbox data yet." compact />;
  }
  if (state.error) return <p className="text-sm text-danger">{state.error}</p>;

  const { collections = [], records = [] } = state.data || {};
  const rows = collection === 'all' ? records : records.filter((r) => r.collection === collection);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          What this workspace&rsquo;s sandbox {integration.name} holds — every sandbox write lands here, and later reads see it.
        </p>
        <div className="flex items-center gap-2">
          <IconButton icon={RefreshCw} label="Reload sandbox data" size="sm" onClick={() => setReloadKey((k) => k + 1)} />
          {canReset && collections.length > 0 && (
            <Button variant="danger-ghost" size="sm" icon={RotateCcw} loading={resetting} onClick={handleReset}>Reset sandbox</Button>
          )}
        </div>
      </div>

      {collections.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Collection">
          <FilterPill active={collection === 'all'} onClick={() => setCollection('all')} count={records.length}>All</FilterPill>
          {collections.map((c) => {
            const short = c.name.startsWith(`${integration.id}.`) ? c.name.slice(integration.id.length + 1) : c.name;
            return <FilterPill key={c.name} active={collection === short} onClick={() => setCollection(short)} count={c.count}>{short}</FilterPill>;
          })}
        </div>
      )}

      <DataTable
        dense
        loading={state.loading}
        rows={rows}
        onRowClick={(r) => setOpen(r)}
        columns={[
          { key: 'collection', header: 'Collection', width: 160, cell: (r) => <code className="font-mono text-xs text-muted">{r.collection}</code> },
          { key: 'doc', header: 'Record', cell: (r) => <span className="line-clamp-1 font-mono text-xs text-fg">{docPreview(r.doc)}</span> },
          { key: 'updatedAt', header: 'Updated', width: 140, align: 'right', cell: (r) => <span className="text-xs text-subtle">{r.updatedAt ? formatRelativeTime(r.updatedAt) : '—'}</span> },
        ]}
        empty={{ icon: Database, title: 'Nothing here yet', body: 'Run a workflow that uses this integration in sandbox mode and its writes show up here.', compact: true }}
      />

      <Drawer
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        title={open ? `${open.collection} record` : ''}
        description={open?.updatedAt ? `Updated ${formatRelativeTime(open.updatedAt)}${open.runId ? ' by a workflow run' : ''}` : undefined}
      >
        {open && (
          <pre className="overflow-auto rounded-control border border-default bg-surface-sunken p-3 font-mono text-xs text-fg">
            {JSON.stringify(open.doc, null, 2)}
          </pre>
        )}
      </Drawer>
    </div>
  );
}
