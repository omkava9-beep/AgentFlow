import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { searchRuns } from '../api/runs';
import { apiErrorMessage } from '../api/client';
import { on } from '../realtime/socket';
import { useWorkspacePath } from '../hooks/useWorkspacePath';
import { useWorkspaceWorkflows } from '../hooks/useWorkspaceWorkflows';
import { useWorkspaceStore } from '../store/workspaceStore';
import { Card, ErrorText, StatusBadge, Button } from '../components/ui';
import TriggerBadge from '../components/TriggerBadge';
import VersionBadge from '../components/versions/VersionBadge';
import { formatDuration } from '../utils/format';

const STATUSES = ['success', 'failed', 'cancelled', 'running', 'waiting', 'pending'];
const TRIGGERS = ['manual', 'schedule', 'webhook', 'event', 'api'];
const RANGES = [
  { id: '', label: 'All time' },
  { id: '24h', label: '24 h', ms: 24 * 3600_000 },
  { id: '7d', label: '7 d', ms: 7 * 86400_000 },
  { id: '30d', label: '30 d', ms: 30 * 86400_000 },
  { id: 'custom', label: 'Custom' },
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
  const range = RANGES.find((r) => r.id === params.get('range'));
  if (range?.ms) q.from = new Date(Date.now() - range.ms).toISOString();
  if (params.get('range') === 'custom') {
    if (params.get('from')) q.from = params.get('from');
    if (params.get('to')) q.to = params.get('to');
  }
  return q;
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-0.5 text-xs capitalize transition ${
        active
          ? 'border-brand-500 bg-brand-500 text-white'
          : 'border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Every run in the workspace, filterable and live (spec/35 §3, §5). With
 * `fixedWorkflowId` it's one workflow's history.
 */
export default function Runs({ fixedWorkflowId = null }) {
  const wp = useWorkspacePath();
  const [params, setParams] = useSearchParams();
  const { workflows } = useWorkspaceWorkflows();
  const workspaceId = useWorkspaceStore((s) => s.current?.id);
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const query = useMemo(() => ({ ...queryFrom(params), ...(fixedWorkflowId && { workflowId: fixedWorkflowId }) }), [params, fixedWorkflowId]);
  const queryKey = JSON.stringify(query);

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value === '' || value == null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };
  const toggleList = (key, value) => {
    const current = (params.get(key) || '').split(',').filter(Boolean);
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    setParam(key, next.join(','));
  };
  const isOn = (key, value) => (params.get(key) || '').split(',').includes(value);

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
    try {
      const page = await searchRuns({ ...query, limit: 25, cursor: nextCursor });
      setItems((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...page.items.filter((r) => !seen.has(r.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load more runs'));
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
    });
    return () => { off(); clearTimeout(refreshTimer.current); };
  }, [workspaceId, refreshFirstPage]);

  const range = params.get('range') || '';

  return (
    <div>
      {!fixedWorkflowId && (
        <div className="mb-4">
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Runs</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Every run in this workspace. Filters live in the URL, so a view can be shared.</p>
        </div>
      )}

      <Card className="mb-4 space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          {!fixedWorkflowId && (
            <select
              value={params.get('workflowId') || ''}
              onChange={(e) => setParam('workflowId', e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              aria-label="Workflow"
            >
              <option value="">All workflows</option>
              {(workflows || []).map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
            </select>
          )}
          <input
            value={params.get('q') || ''}
            onChange={(e) => setParam('q', e.target.value.trim())}
            placeholder="Run id…"
            className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            aria-label="Run id prefix"
          />
          <input
            value={params.get('version') || ''}
            onChange={(e) => setParam('version', e.target.value.trim())}
            placeholder="Version (3 or draft)"
            className="w-36 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            aria-label="Version"
          />
          <div className="flex items-center gap-1">
            {RANGES.map((r) => <Chip key={r.id} active={range === r.id} onClick={() => setParam('range', r.id)}>{r.label}</Chip>)}
          </div>
          {range === 'custom' && (
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <input type="date" value={params.get('from') || ''} onChange={(e) => setParam('from', e.target.value)} className="rounded border border-slate-200 bg-white px-1 py-0.5 dark:border-slate-700 dark:bg-slate-900" />
              –
              <input type="date" value={params.get('to') || ''} onChange={(e) => setParam('to', e.target.value)} className="rounded border border-slate-200 bg-white px-1 py-0.5 dark:border-slate-700 dark:bg-slate-900" />
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[10px] uppercase tracking-wide text-slate-400">Status</span>
          {STATUSES.map((s) => <Chip key={s} active={isOn('status', s)} onClick={() => toggleList('status', s)}>{s}</Chip>)}
          <span className="ml-3 mr-1 text-[10px] uppercase tracking-wide text-slate-400">Trigger</span>
          {TRIGGERS.map((t) => <Chip key={t} active={isOn('trigger', t)} onClick={() => toggleList('trigger', t)}>{t}</Chip>)}
        </div>
      </Card>

      <ErrorText>{error}</ErrorText>

      {loading && !items.length ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      ) : !items.length ? (
        <Card className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">No runs match these filters.</Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:bg-slate-900">
              <tr>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Run</th>
                {!fixedWorkflowId && <th className="px-3 py-2">Workflow</th>}
                <th className="px-3 py-2">Trigger</th>
                <th className="px-3 py-2">Version</th>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2 text-right">Duration</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/60">
                  <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2">
                    <Link to={wp(`/runs/${r.id}`)} className="font-mono text-xs text-brand-600 hover:underline dark:text-brand-400">#{r.id.slice(-6)}</Link>
                    {r.rerunOf && <span className="ml-1 text-[10px] text-slate-400" title="Re-run">↻</span>}
                    {r.retryOf && <span className="ml-1 text-[10px] text-slate-400" title="Retry from failed">⟲</span>}
                    {r.childCount > 0 && <span className="ml-1 text-[10px] text-slate-400" title="Child runs">↗{r.childCount}</span>}
                    {r.failReason === 'interrupted' && <span className="ml-1 text-[10px] text-red-500">interrupted</span>}
                  </td>
                  {!fixedWorkflowId && (
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                      <Link to={wp(`/workflows/${r.workflowId}`)} className="hover:underline">{r.workflowName}</Link>
                    </td>
                  )}
                  <td className="px-3 py-2"><TriggerBadge trigger={r.trigger} test={r.test} /></td>
                  <td className="px-3 py-2"><VersionBadge isDraft={r.isDraft} versionNumber={r.versionNumber} /></td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{new Date(r.startedAt || r.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-xs text-slate-500 dark:text-slate-400">{formatDuration(r.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {nextCursor && (
        <div className="mt-3 text-center">
          <Button variant="secondary" onClick={loadMore}>Load more</Button>
        </div>
      )}
    </div>
  );
}
