import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, FilePlus2, Hourglass, LayoutGrid, LayoutTemplate, List, Plus, Search, Webhook, Workflow as WorkflowIcon, X,
  Activity as ActivityIcon,
} from 'lucide-react';
import { listWorkflows, createWorkflow, deleteWorkflow, getWorkflow, updateWorkflow, createRun } from '../api/workflows';
import { listTemplates } from '../api/templates';
import { apiErrorMessage } from '../api/client';
import {
  Avatar, Button, DataTable, EmptyState, Input, IntegrationLogo, Kbd, Menu, MenuButton, PageHeader, Segmented, Select, SkeletonGrid, StatTile, Tooltip,
} from '../components/ui/index';
import { ErrorText } from '../components/ui.jsx';
import WorkflowCard from '../components/WorkflowCard';
import WorkflowActions from '../components/workflows/WorkflowActions';
import { Activity, IntegrationStack, LastRun, Sparkline, TriggerIcons, VersionBadge } from '../components/workflows/parts';
import {
  STATUS_FILTERS, SORTS, TRIGGER_META, displayIntegrations, matchesStatus, leadMark, sortWorkflows, successRate, triggerLine, triggerTypes,
} from '../components/workflows/workflowMeta';
import ShareDialog from '../components/ShareDialog';
import OnboardingChecklist from '../components/OnboardingChecklist';
import { useWorkspacePath } from '../hooks/useWorkspacePath';
import { useCan } from '../hooks/useCan';
import { usePendingApprovals } from '../hooks/usePendingApprovals';
import { useIntegrationStore } from '../store/integrationStore';
import { useToastStore } from '../store/toastStore';
import { confirm } from '../components/ui/confirm';
import { formatRelativeTime } from '../utils/time';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

const VIEW_KEY = 'agentflow:workflows-view';

/**
 * A row's leading mark: the workflow's main integration, so rows differ at a
 * glance (a Stripe flow shows Stripe). Falls back to a neutral workflow glyph.
 */

/** "Alice · 2m ago" - who last changed it, and when. */
function UpdatedBy({ workflow }) {
  const person = workflow.updatedBy || workflow.createdBy;
  return (
    <Tooltip content={person ? `Updated by ${person.name || person.email}` : 'Last updated'}>
      <span className="flex shrink-0 items-center gap-1 tabular-nums">
        {person && <Avatar name={person.name} email={person.email} seed={person.id} size="xs" />}
        {formatRelativeTime(workflow.updatedAt)}
      </span>
    </Tooltip>
  );
}

function PrimaryMark({ workflow }) {
  const mark = leadMark(workflow);
  if (mark.kind === 'integration') return <IntegrationLogo id={mark.id} size="lg" />;
  const Icon = mark.kind === 'schedule' ? CalendarClock : mark.kind === 'webhook' ? Webhook : WorkflowIcon;
  const label = mark.kind === 'schedule' ? 'Scheduled' : mark.kind === 'webhook' ? 'Webhook' : 'Workflow';
  return (
    <span aria-label={label} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-default bg-bg-subtle text-muted">
      <Icon className="h-4 w-4" aria-hidden="true" />
    </span>
  );
}

function readView() {
  try { return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'table'; } catch { return 'table'; }
}

export default function Dashboard() {
  const [workflows, setWorkflows] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [trigger, setTrigger] = useState('any');
  const [integration, setIntegration] = useState('any');
  const [sort, setSort] = useState('updated');
  const [view, setViewState] = useState(readView);
  const [sharing, setSharing] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const searchRef = useRef(null);
  const wide = useMediaQuery('(min-width: 1280px)');
  const navigate = useNavigate();
  const wp = useWorkspacePath();
  const canEdit = useCan('workflow:edit');
  const canUseTemplates = useCan('templates:use');
  const { items: pending } = usePendingApprovals();
  const { catalog, loadCatalog } = useIntegrationStore();
  useDocumentTitle('Workflows');

  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // "/" jumps to search, the way list pages in most tools behave.
  useEffect(() => {
    function onKey(e) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function load() {
    try {
      const data = await listWorkflows();
      setWorkflows(data);
      if (!data.length && canUseTemplates) {
        listTemplates().then((ts) => setSuggestions(ts.filter((t) => t.builtIn && !t.companion).slice(0, 3))).catch(() => {});
      }
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load workflows'));
      setWorkflows([]);
    }
  }

  function setView(v) {
    setViewState(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* per-browser preference only */ }
  }

  const names = useMemo(() => {
    const m = new Map((catalog || []).map((i) => [i.id, i.name]));
    m.set('ai', 'AI agent');
    m.set('builtin', 'Built-in demo tools');
    return m;
  }, [catalog]);

  const integrationOptions = useMemo(() => {
    const ids = new Set((workflows || []).flatMap(displayIntegrations));
    return [{ value: 'any', label: 'Any integration' }, ...[...ids].sort().map((id) => ({ value: id, label: names.get(id) || id }))];
  }, [workflows, names]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (workflows || []).filter((wf) => (
      (!q || wf.name.toLowerCase().includes(q) || triggerLine(wf, names).toLowerCase().includes(q))
      && matchesStatus(wf, status)
      && (trigger === 'any' || triggerTypes(wf).includes(trigger))
      && (integration === 'any' || displayIntegrations(wf).includes(integration))
    ));
    return sortWorkflows(filtered, sort);
  }, [workflows, query, status, trigger, integration, sort, names]);

  const kpis = useMemo(() => {
    const list = workflows || [];
    const daily = Array.from({ length: 8 }, (_, i) => list.reduce((sum, wf) => sum + (wf.stats7d?.daily?.[i] || 0), 0));
    const total = list.reduce((s, wf) => s + (wf.stats7d?.total || 0), 0);
    const success = list.reduce((s, wf) => s + (wf.stats7d?.success || 0), 0);
    const failed = list.reduce((s, wf) => s + (wf.stats7d?.failed || 0), 0);
    return {
      daily, total, failed,
      rate: successRate({ success, failed }),
      failing: list.filter((wf) => wf.lastRun?.status === 'failed').length,
      published: list.filter((wf) => wf.publishedVersion).length,
    };
  }, [workflows]);

  const filtersActive = query || status !== 'all' || trigger !== 'any' || integration !== 'any';
  function clearFilters() { setQuery(''); setStatus('all'); setTrigger('any'); setIntegration('any'); }

  async function handleCreate() {
    setCreating(true);
    try {
      const wf = await createWorkflow('Untitled workflow');
      navigate(wp(`/workflows/${wf._id}`));
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to create workflow'));
      setCreating(false);
    }
  }

  async function handleDelete(wf) {
    if (!(await confirm({ title: `Delete “${wf.name}”?`, body: 'Its versions, runs and comments go with it. This cannot be undone.', confirmLabel: 'Delete workflow', destructive: true }))) return;
    try {
      await deleteWorkflow(wf._id);
      setWorkflows((wfs) => wfs.filter((w) => w._id !== wf._id));
      useToastStore.getState().push(`Deleted “${wf.name}”.`, 'success');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to delete workflow'));
    }
  }

  async function handleDuplicate(wf) {
    try {
      const full = await getWorkflow(wf._id);
      const copy = await createWorkflow(`${wf.name} (copy)`);
      await updateWorkflow(copy._id, { nodes: full.nodes, edges: full.edges });
      useToastStore.getState().push(`Duplicated “${wf.name}”.`, 'success');
      navigate(wp(`/workflows/${copy._id}`));
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to duplicate workflow'));
    }
  }

  async function handleRunPublished(wf) {
    try {
      const { runId } = await createRun(wf._id, 'published');
      navigate(wp(`/runs/${runId}`));
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to start the run'));
    }
  }

  const actions = { onRunPublished: handleRunPublished, onDuplicate: handleDuplicate, onShare: setSharing, onDelete: handleDelete };

  const allColumns = [
    {
      key: 'name',
      header: 'Workflow',
      sortable: true,
      sortValue: (wf) => wf.name.toLowerCase(),
      cell: (wf) => (
        <div className="flex min-w-0 items-center gap-3">
          <PrimaryMark workflow={wf} />
          <div className="min-w-0 max-w-[360px]">
            <p className="truncate font-medium text-fg" data-testid="workflow-row-name">{wf.name}</p>
            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-subtle">
              <TriggerIcons workflow={wf} />
              <span className="truncate">{triggerLine(wf, names)}</span>
              <span aria-hidden="true">·</span>
              <UpdatedBy workflow={wf} />
            </p>
          </div>
        </div>
      ),
    },
    { key: 'integrations', header: 'Uses', cell: (wf) => <IntegrationStack workflow={wf} names={names} />, width: 120 },
    { key: 'status', header: 'Status', sortable: true, sortValue: (wf) => wf.publishedVersion || 0, cell: (wf) => <VersionBadge workflow={wf} />, width: 150 },
    {
      key: 'lastRun', header: 'Last run', sortable: true, width: 160, className: 'whitespace-nowrap',
      sortValue: (wf) => (wf.lastRun?.startedAt ? new Date(wf.lastRun.startedAt).getTime() : null),
      cell: (wf) => <LastRun workflow={wf} wp={wp} />,
    },
    {
      key: 'activity', header: '7 days', sortable: true, width: 110, align: 'right', className: 'whitespace-nowrap',
      sortValue: (wf) => wf.stats7d?.total || 0,
      cell: (wf) => <Activity workflow={wf} />,
    },
    { key: 'actions', header: <span className="sr-only">Actions</span>, width: 40, align: 'right', className: '!pl-0 !pr-2', cell: (wf) => <WorkflowActions workflow={wf} wp={wp} {...actions} /> },
  ];

  // The kit's table can't hide a column's header per breakpoint, so narrow
  // screens get fewer columns instead of a sideways scroll to reach ⋯.
  const columns = wide ? allColumns : allColumns.filter((c) => c.key !== 'integrations' && c.key !== 'activity');

  const newButton = canEdit && (
    <div className="flex items-center">
      <Button icon={Plus} onClick={handleCreate} loading={creating} className="rounded-r-none" data-testid="new-workflow">
        New workflow
      </Button>
      <Menu
        label={<ChevronDown className="h-4 w-4" aria-hidden="true" />}
        title="More ways to create"
        align="right"
        buttonClassName="inline-flex h-8 items-center rounded-r-control border-l border-accent-fg/20 bg-accent px-2 text-accent-fg transition-colors hover:bg-accent-hover"
      >
        <MenuButton onClick={handleCreate}><FilePlus2 className="h-4 w-4" /> Blank workflow</MenuButton>
        <MenuButton onClick={() => navigate(wp('/templates'))}><LayoutTemplate className="h-4 w-4" /> From a template</MenuButton>
      </Menu>
    </div>
  );

  const loading = workflows === null;
  const empty = !loading && workflows.length === 0;

  return (
    <div>
      <PageHeader
        title="Workflows"
        meta={!loading && <span className="rounded-full bg-bg-subtle px-2 py-0.5 text-xs font-medium tabular-nums text-muted">{workflows.length}</span>}
        description="Everything this workspace automates — what starts it, what it touches, and how it's running."
        actions={newButton}
      />

      <OnboardingChecklist />
      <ErrorText>{error}</ErrorText>

      {!empty && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="workflow-kpis">
          <StatTile label="Runs · last 7 days" value={loading ? '—' : kpis.total} hint={loading ? '' : `${kpis.failed} failed`} icon={ActivityIcon}>
            {!loading && <Sparkline daily={kpis.daily} height={36} className="ml-auto" />}
          </StatTile>
          <StatTile label="Success rate" value={loading || kpis.rate == null ? '—' : `${kpis.rate}%`} hint="Finished runs, 7 days" icon={CheckCircle2} />
          <StatTile label="Failing workflows" value={loading ? '—' : kpis.failing} hint={kpis.failing ? 'Last run failed' : 'All last runs healthy'} icon={AlertTriangle} />
          <StatTile label="Awaiting approval" value={pending ? pending.length : '—'} hint={pending?.length ? 'Runs paused for you' : 'Nothing waiting'} icon={Hourglass} />
        </div>
      )}

      {!empty && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" aria-hidden="true" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && visible[0]) navigate(wp(`/workflows/${visible[0]._id}`));
                if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); }
              }}
              placeholder="Search workflows"
              aria-label="Search workflows"
              className="pl-8 pr-8"
              data-testid="workflow-search"
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"><Kbd>/</Kbd></span>
          </div>
          <div className="w-[170px]"><Select size="sm" value={status} onValueChange={setStatus} options={STATUS_FILTERS} aria-label="Filter by status" data-testid="filter-status" /></div>
          <div className="w-[140px]"><Select
            size="sm"
            value={trigger}
            onValueChange={setTrigger}
            aria-label="Filter by trigger"
            data-testid="filter-trigger"
            options={[{ value: 'any', label: 'Any trigger' }, ...Object.entries(TRIGGER_META).map(([value, m]) => ({ value, label: m.label, icon: m.icon }))]}
          /></div>
          <div className="w-[170px]"><Select size="sm" value={integration} onValueChange={setIntegration} options={integrationOptions} aria-label="Filter by integration" data-testid="filter-integration" /></div>
          {filtersActive && <Button variant="ghost" size="sm" icon={X} onClick={clearFilters}>Clear</Button>}
          <div className="ml-auto flex items-center gap-2">
            {/* The table sorts by its column headers; the grid needs its own control. */}
            {view === 'grid' && <div className="w-[140px]"><Select size="sm" value={sort} onValueChange={setSort} options={SORTS} aria-label="Sort" /></div>}
            <Segmented
              aria-label="View"
              value={view}
              onChange={setView}
              items={[{ value: 'table', label: 'Table', icon: List }, { value: 'grid', label: 'Grid', icon: LayoutGrid }]}
            />
          </div>
        </div>
      )}

      {loading ? (
        view === 'grid' ? <SkeletonGrid count={6} /> : <DataTable columns={columns} rows={[]} loading loadingRows={6} />
      ) : empty ? (
        <EmptyState
          icon={WorkflowIcon}
          title="No workflows yet"
          body={canEdit
            ? 'A workflow wires agents, tools and integrations into a graph you can run, schedule or trigger from outside. Start blank, or from a template built around a real problem.'
            : 'Nobody has built a workflow in this workspace yet.'}
          action={canEdit && <Button icon={Plus} onClick={handleCreate} loading={creating}>New workflow</Button>}
          secondaryAction={canEdit && <Button variant="secondary" icon={LayoutTemplate} onClick={() => navigate(wp('/templates'))}>Browse templates</Button>}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          compact
          icon={Search}
          title="No workflows match"
          body="Try a different search or clear the filters."
          action={<Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>}
        />
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="workflow-grid">
          {visible.map((wf) => <WorkflowCard key={wf._id} workflow={wf} wp={wp} names={names} actions={actions} />)}
        </div>
      ) : (
        <div data-testid="workflow-table">
          <DataTable
            columns={columns}
            rows={visible}
            onRowClick={(wf) => navigate(wp(`/workflows/${wf._id}`))}
            footer={(
              <span className="text-xs text-subtle">
                {visible.length} of {workflows.length} workflows · {kpis.published} published
              </span>
            )}
          />
        </div>
      )}

      {empty && suggestions.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-xs font-medium text-subtle">Popular starting points</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {suggestions.map((t) => (
              <button
                key={t._id}
                type="button"
                onClick={() => navigate(wp(`/templates?template=${t._id}`))}
                className="rounded-card border border-default bg-surface p-4 text-left transition-colors hover:border-strong hover:bg-bg-subtle/40"
              >
                <p className="text-sm font-medium text-fg">{t.name}</p>
                <p className="mt-1 line-clamp-2 text-xs text-muted">{t.summary}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {sharing && (
        <ShareDialog workflowId={sharing._id} onClose={() => setSharing(null)} />
      )}
    </div>
  );
}
