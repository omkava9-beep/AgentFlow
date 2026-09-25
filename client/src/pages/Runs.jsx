import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PlayCircle, Search, X, ListFilter } from 'lucide-react';
import { searchRuns } from '../api/runs';
import { apiErrorMessage } from '../api/client';
import { on } from '../realtime/socket';
import { useWorkspacePath } from '../hooks/useWorkspacePath';
import { useWorkspaceWorkflows } from '../hooks/useWorkspaceWorkflows';
import { useWorkspaceStore } from '../store/workspaceStore';
import {
  PageHeader, DataTable, StatusBadge, StatusIcon, Button, Input, Select, Combobox, MultiSelect, Segmented,
  DateRangePicker, Toolbar, cx,
} from '../components/ui';
import { ErrorText } from '../components/ui.jsx';
import TriggerBadge from '../components/TriggerBadge';
import VersionBadge from '../components/versions/VersionBadge';
import { RelativeTime, Duration, NodeProgress, LineageIcons, TriggeredBy } from '../components/runs/RunBits';
import { useMediaQuery } from '../hooks/useMediaQuery';

const NARROW_HIDDEN = new Set(['version', 'by']);
import { shortId } from '../utils/runIds';

const STATUSES = ['success', 'failed', 'running', 'waiting', 'cancelled', 'pending'];
const STATUS_LABELS = { success: 'Succeeded', failed: 'Failed', running: 'Running', waiting: 'Waiting', cancelled: 'Cancelled', pending: 'Pending' };
const TRIGGERS = [
  { value: 'manual', label: 'Manual' },
  { value: 'schedule', label: 'Scheduled' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'event', label: 'Event' },
  { value: 'api', label: 'API' },
];
const RANGES = [
  { value: 'all', label: 'All time' },
  { value: '24h', label: '24h', ms: 24 * 3600_000 },
  { value: '7d', label: '7d', ms: 7 * 86400_000 },
  { value: '30d', label: '30d', ms: 30 * 86400_000 },
  { value: 'custom', label: 'Custom' },
];

/** The API query for the filters in the URL (spec/35 §3: a filtered view is a shareable link). */
function queryFrom(params) {
  const q = {};
  for (const key of ['workflowId', 'status', 'trigger']) {
    if (params.get(key)) q[key] = params.get(key);
  }
  // Half-typed values would only earn a 400: send them once they're valid.
  if (/^[0-9a-f]{4,24}$/i.test(params.get('q') || '')) q.q = params.get('q');
  if (/^(\d+|draft)$/.test(params.get('version') || '')) q.version = params.get('version');
  const range = RANGES.find((r) => r.value === params.get('range'));
  if (range?.ms) q.from = new Date(Date.now() - range.ms).toISOString();
  if (params.get('range') === 'custom') {
    if (params.get('from')) q.from = params.get('from');
    if (params.get('to')) q.to = params.get('to');
  }
  return q;
}

/** A multi-select status pill (quick filter). */
function StatusPill({ status, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
        active ? 'border-accent bg-accent-subtle text-accent-subtle-fg' : 'border-default bg-surface text-muted hover:border-strong hover:text-fg',
      )}
    >
      <StatusIcon status={status} className="h-3.5 w-3.5" />
      {STATUS_LABELS[status]}
    </button>
  );
}

/**
 * Every run in the workspace, filterable and live (spec/35 §3, §5). With
 * `fixedWorkflowId` it's one workflow's history (no page header, no workflow filter).
 */
export default function Runs({ fixedWorkflowId = null }) {
  const wp = useWorkspacePath();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { workflows } = useWorkspaceWorkflows();
  const workspaceId = useWorkspaceStore((s) => s.current?.id);
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [idDraft, setIdDraft] = useState(params.get('q') || '');

  const query = useMemo(() => ({ ...queryFrom(params), ...(fixedWorkflowId && { workflowId: fixedWorkflowId }) }), [params, fixedWorkflowId]);
  const queryKey = JSON.stringify(query);

  const setParam = useCallback((key, value) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === '' || value == null || (Array.isArray(value) && !value.length)) next.delete(key);
      else next.set(key, Array.isArray(value) ? value.join(',') : value);
      return next;
    }, { replace: true });
  }, [setParams]);
  const listParam = (key) => (params.get(key) || '').split(',').filter(Boolean);
  const toggleStatus = (value) => {
    const current = listParam('status');
    setParam('status', current.includes(value) ? current.filter((v) => v !== value) : [...current, value]);
  };

  // The run-id box writes to the URL once it's a usable prefix (or cleared).
  useEffect(() => {
    const t = setTimeout(() => {
      const v = idDraft.trim();
      if (!v || /^[0-9a-f]{4,24}$/i.test(v.replace(/^#/, ''))) setParam('q', v.replace(/^#/, ''));
    }, 250);
    return () => clearTimeout(t);
  }, [idDraft, setParam]);

  // Filters changed → start again from the top; a cursor only encodes position.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    searchRuns({ ...JSON.parse(queryKey), limit: 25 })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((err) => !cancelled && setError(apiErrorMessage(err, 'Failed to load runs')))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [queryKey]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await searchRuns({ ...query, limit: 25, cursor: nextCursor });
      setItems((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...page.items.filter((r) => !seen.has(r.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load more runs'));
    } finally {
      setLoadingMore(false);
    }
  }

  // Live (spec/35 §5): known rows update in place; unknown ones mean something
  // new may match - refetch the first page (debounced) and prepend what's new.
  const refreshTimer = useRef(null);
  const refreshFirstPage = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(async () => {
      try {
        const page = await searchRuns({ ...JSON.parse(queryKey), limit: 25 });
        setItems((prev) => {
          const byId = new Map(page.items.map((r) => [r.id, r]));
          const fresh = page.items.filter((r) => !prev.some((p) => p.id === r.id));
          return [...fresh, ...prev.map((r) => byId.get(r.id) || r)];
        });
      } catch { /* the next event retries */ }
    }, 800);
  }, [queryKey]);

  useEffect(() => {
    if (!workspaceId) return undefined;
    const off = on('run:status_changed', (p) => {
      setItems((prev) => {
        if (!prev.some((r) => r.id === p.runId)) {
          if (!p.parentRunId) refreshFirstPage();
          return prev;
        }
        return prev.map((r) => (r.id === p.runId ? { ...r, status: p.status, finishedAt: p.finishedAt ?? r.finishedAt } : r));
      });
      // A finished run's counts/duration only exist server-side; refresh them.
      if (['success', 'failed', 'cancelled'].includes(p.status)) refreshFirstPage();
    });
    return () => { off(); clearTimeout(refreshTimer.current); };
  }, [workspaceId, refreshFirstPage]);

  const range = params.get('range') || '';
  const maxVersion = Math.max(0, ...(workflows || [])
    .filter((w) => !fixedWorkflowId || w._id === fixedWorkflowId)
    .map((w) => w.publishedVersion || 0));
  const versionOptions = [
    { value: '', label: 'Any version' },
    { value: 'draft', label: 'Draft test runs' },
    ...Array.from({ length: maxVersion }, (_, i) => ({ value: String(maxVersion - i), label: `v${maxVersion - i}` })),
  ];
  const activeFilters = ['workflowId', 'status', 'trigger', 'version', 'range', 'q'].filter((k) => params.get(k) && !(k === 'workflowId' && fixedWorkflowId));

  // Below 1280px the table would scroll sideways; version and who-started-it
  // are the columns you can most easily do without (both show in the run).
  const wide = useMediaQuery('(min-width: 1280px)');
  const columns = [
    { key: 'status', header: 'Status', width: 128, cell: (r) => <StatusBadge status={r.failReason === 'interrupted' ? 'interrupted' : r.status} /> },
    {
      key: 'id', header: 'Run', width: 120,
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <Link to={wp(`/runs/${r.id}`)} onClick={(e) => e.stopPropagation()} className="font-mono text-xs text-accent hover:underline">{shortId(r.id)}</Link>
          <LineageIcons run={r} />
        </span>
      ),
    },
    ...(!fixedWorkflowId ? [{
      key: 'workflow', header: 'Workflow',
      cell: (r) => (
        <Link to={wp(`/workflows/${r.workflowId}`)} onClick={(e) => e.stopPropagation()} className="block max-w-[14rem] truncate font-medium text-fg hover:underline">
          {r.workflowName}
        </Link>
      ),
    }] : []),
    { key: 'trigger', header: 'Trigger', className: 'whitespace-nowrap', cell: (r) => <TriggerBadge trigger={r.trigger} test={r.test} /> },
    { key: 'version', header: 'Version', cell: (r) => (r.isDraft || r.versionNumber ? <VersionBadge isDraft={r.isDraft} versionNumber={r.versionNumber} /> : <span className="text-subtle">—</span>) },
    { key: 'started', header: 'Started', className: 'whitespace-nowrap', cell: (r) => <RelativeTime value={r.startedAt || r.createdAt} className="text-muted" /> },
    { key: 'duration', header: 'Duration', align: 'right', className: 'whitespace-nowrap', cell: (r) => <Duration ms={r.durationMs} running={['running', 'pending'].includes(r.status)} startedAt={r.startedAt} /> },
    { key: 'nodes', header: 'Nodes', cell: (r) => <NodeProgress counts={r.nodeCounts} maxAttempts={r.maxAttempts} /> },
    { key: 'by', header: '', width: 44, align: 'right', cell: (r) => <TriggeredBy run={r} /> },
  ].filter((c) => wide || !NARROW_HIDDEN.has(c.key));

  const filters = (
    <div className="mb-4 space-y-3">
      <Toolbar className="flex-wrap gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" aria-hidden="true" />
          <Input size="sm" value={idDraft} onChange={(e) => setIdDraft(e.target.value)} placeholder="Run id…" aria-label="Run id prefix" className="w-36 pl-8 font-mono" />
        </div>
        {!fixedWorkflowId && (
          <div className="w-56"><Combobox
            size="sm"
            placeholder="All workflows"
            searchPlaceholder="Find a workflow…"
            aria-label="Workflow"
            clearable
            value={params.get('workflowId') || ''}
            onChange={(v) => setParam('workflowId', v || '')}
            options={(workflows || []).map((w) => ({ value: w._id, label: w.name }))}
          /></div>
        )}
        <div className="w-44"><MultiSelect
          size="sm"
          placeholder="Any trigger"
          aria-label="Trigger"
          value={listParam('trigger')}
          onChange={(v) => setParam('trigger', v)}
          options={TRIGGERS}
        /></div>
         <div className="w-40"><Select size="sm" aria-label="Version" value={params.get('version') || ''} onValueChange={(v) => setParam('version', v)} options={versionOptions} /></div>
        <Segmented size="sm" aria-label="Time range" value={range || 'all'} onChange={(v) => setParam('range', v === 'all' ? '' : v)} items={RANGES.map(({ value, label }) => ({ value, label }))} />
        {range === 'custom' && (
          <div className="w-60"><DateRangePicker
            aria-label="Custom date range"
            value={{ from: params.get('from') || '', to: params.get('to') || '' }}
            onChange={({ from, to }) => { setParam('from', from); setParam('to', to); }}
          /></div>
        )}
        {activeFilters.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            icon={X}
            onClick={() => { setIdDraft(''); setParams(new URLSearchParams(), { replace: true }); }}
          >
            Clear filters
          </Button>
        )}
      </Toolbar>
      <div className="flex flex-wrap items-center gap-1.5">
        <ListFilter className="mr-0.5 h-3.5 w-3.5 text-subtle" aria-hidden="true" />
        {STATUSES.map((s) => <StatusPill key={s} status={s} active={listParam('status').includes(s)} onClick={() => toggleStatus(s)} />)}
      </div>
    </div>
  );

  return (
    <div>
      {!fixedWorkflowId && (
        <PageHeader
          icon={PlayCircle}
          title="Runs"
          description="Every run in this workspace, live. Filters live in the URL, so a view can be shared."
        />
      )}
      {filters}
      <ErrorText>{error}</ErrorText>
      <DataTable
        dense
        columns={columns}
        rows={items}
        loading={loading && !items.length}
        onRowClick={(r) => navigate(wp(`/runs/${r.id}`))}
        rowClassName={(r) => (r.status === 'failed' ? 'bg-danger-subtle/20' : '')}
        empty={{
          icon: PlayCircle,
          title: activeFilters.length ? 'No runs match these filters' : 'No runs yet',
          body: activeFilters.length
            ? 'Try a wider time range or clear the filters.'
            : 'Test-run a workflow from the Builder, or publish it so its triggers can start runs.',
          action: activeFilters.length
            ? <Button size="sm" variant="secondary" onClick={() => { setIdDraft(''); setParams(new URLSearchParams(), { replace: true }); }}>Clear filters</Button>
            : null,
        }}
        footer={items.length > 0 ? (
          <div className="flex items-center justify-between text-xs text-subtle">
            <span className="tabular-nums">{items.length} run{items.length === 1 ? '' : 's'}{nextCursor ? ' loaded' : ''}</span>
            {nextCursor && <Button size="sm" variant="secondary" loading={loadingMore} onClick={loadMore}>Load more</Button>}
          </div>
        ) : null}
      />
    </div>
  );
}
