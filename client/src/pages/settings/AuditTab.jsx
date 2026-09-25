import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listAudit, downloadAuditCsv } from '../../api/audit';
import { listMembers } from '../../api/members';
import { apiErrorMessage } from '../../api/client';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useWorkspacePath } from '../../hooks/useWorkspacePath';
import { useCan } from '../../hooks/useCan';
import { formatRelativeTime } from '../../utils/time';
import { Button, Card, ErrorText, Select, TextField } from '../../components/ui';

// Colour-coded by what kind of access the action changed (spec/34 UI).
const CATEGORIES = [
  { key: 'members', label: 'Members', prefixes: ['member.', 'invitation.'], className: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  { key: 'access', label: 'Access', prefixes: ['apikey.', 'share.'], className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  { key: 'connections', label: 'Connections', prefixes: ['connection.'], className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  { key: 'workflows', label: 'Workflows', prefixes: ['workflow.', 'trigger.', 'webhook.', 'template.'], className: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
  { key: 'workspace', label: 'Workspace', prefixes: ['workspace.'], className: 'bg-slate-200 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200' },
];
const categoryOf = (action) => CATEGORIES.find((c) => c.prefixes.some((p) => action.startsWith(p))) || CATEGORIES[4];

const ACTION_FILTERS = [
  ['', 'All actions'],
  ['member.*', 'Members'],
  ['invitation.*', 'Invitations'],
  ['apikey.*', 'API keys'],
  ['connection.*', 'Connections'],
  ['share.*', 'Sharing'],
  ['trigger.*', 'Triggers'],
  ['webhook.*', 'Webhooks'],
  ['workflow.*', 'Workflows'],
  ['workspace.*', 'Workspace'],
  ['template.*', 'Templates'],
];

const TARGET_TYPES = ['workspace', 'member', 'invitation', 'apiKey', 'connection', 'workflow', 'template'];

// Date inputs give local calendar days; the API wants instants.
const dayStart = (d) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);
const dayEnd = (d) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined);

const show = (value) => {
  if (value === '[redacted]') return '••••';
  if (value === null || value === undefined) return '—';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

function ActorCell({ item }) {
  if (item.actorType === 'apiKey') {
    return <span className="inline-flex items-center gap-1"><span aria-hidden>🔑</span>{item.actorLabel}</span>;
  }
  if (item.actorType === 'system') {
    return <span className="inline-flex items-center gap-1 text-slate-500"><span aria-hidden>⚙️</span>{item.actorLabel}</span>;
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-500/15 text-[10px] font-semibold uppercase text-brand-700 dark:text-brand-300">
        {item.actorLabel?.[0] || '?'}
      </span>
      <span>
        {item.actorLabel}
        {item.actorIsMember === false && <span className="ml-1 text-xs text-slate-400">(no longer a member)</span>}
      </span>
    </span>
  );
}

/** before → after, field by field; redacted values show that a field changed, not to what. */
function Diff({ item }) {
  const keys = [...new Set([...Object.keys(item.before || {}), ...Object.keys(item.after || {})])];
  const meta = item.meta && Object.keys(item.meta).length ? item.meta : null;
  if (!keys.length && !meta) return <p className="text-xs text-slate-400">No field details recorded.</p>;
  return (
    <div className="space-y-2 text-xs">
      {keys.length > 0 && (
        <table className="w-full max-w-xl">
          <tbody>
            {keys.map((k) => (
              <tr key={k}>
                <td className="py-0.5 pr-3 font-mono text-slate-500">{k}</td>
                <td className="py-0.5 pr-2 font-mono text-red-600 line-through decoration-red-300 dark:text-red-400">{show(item.before?.[k])}</td>
                <td className="py-0.5 pr-2 text-slate-400">→</td>
                <td className="py-0.5 font-mono text-emerald-700 dark:text-emerald-400">{show(item.after?.[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {meta && (
        <p className="font-mono text-slate-500">
          {Object.entries(meta).map(([k, v]) => `${k}: ${show(v)}`).join(' · ')}
        </p>
      )}
      {item.ip && <p className="text-slate-400">IP {item.ip}</p>}
    </div>
  );
}

export default function AuditTab() {
  const current = useWorkspaceStore((s) => s.current);
  const allowed = useCan('audit:read');
  const wp = useWorkspacePath();
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [members, setMembers] = useState([]);
  // "View log" links from other tabs arrive pre-filtered (?action=member.*).
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState(() => ({
    action: ACTION_FILTERS.some(([v]) => v === searchParams.get('action')) ? searchParams.get('action') : '',
    actor: '', targetType: '', from: '', to: '',
  }));

  // The actor dropdown mixes members (by id) with the two non-user actor types.
  const query = useCallback(() => {
    const q = { action: filters.action, targetType: filters.targetType, from: dayStart(filters.from), to: dayEnd(filters.to) };
    if (filters.actor === 'apiKey' || filters.actor === 'system') q.actorType = filters.actor;
    else if (filters.actor) q.actorId = filters.actor;
    return q;
  }, [filters]);

  const load = useCallback(async () => {
    if (!current || !allowed) return;
    setLoading(true);
    setError('');
    try {
      const page = await listAudit(current.id, query());
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load the audit log'));
    } finally {
      setLoading(false);
    }
  }, [current, allowed, query]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!current || !allowed) return;
    listMembers(current.id).then(setMembers).catch(() => setMembers([]));
  }, [current, allowed]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const page = await listAudit(current.id, { ...query(), before: cursor });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load more'));
    } finally {
      setLoadingMore(false);
    }
  }

  async function exportCsv() {
    try {
      await downloadAuditCsv(current.id, query(), `audit-${current.slug}-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err) {
      setError(apiErrorMessage(err, 'Export failed'));
    }
  }

  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const filtered = Object.values(filters).some(Boolean);

  if (!allowed) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Only owners and admins can read the audit log.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Audit log</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Who changed members, access, connections, sharing and triggers in this workspace. Entries can't be edited or deleted.
          </p>
        </div>
        <Button variant="secondary" onClick={exportCsv} disabled={loading}>Export CSV</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Select label="Action" value={filters.action} onChange={set('action')}>
          {ACTION_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Select label="Actor" value={filters.actor} onChange={set('actor')}>
          <option value="">Anyone</option>
          {members.map((m) => <option key={m.userId} value={m.userId}>{m.email}</option>)}
          <option value="apiKey">API keys</option>
          <option value="system">System</option>
        </Select>
        <Select label="Target" value={filters.targetType} onChange={set('targetType')}>
          <option value="">Any target</option>
          {TARGET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
        <TextField label="From" type="date" value={filters.from} onChange={set('from')} />
        <TextField label="To" type="date" value={filters.to} onChange={set('to')} />
      </div>

      <ErrorText>{error}</ErrorText>

      <Card className="overflow-hidden">
        {loading ? (
          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">Loading...</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {filtered
              ? 'No entries match these filters.'
              : 'No administrative activity yet. Changes to members, keys, connections and sharing will appear here.'}
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Actor</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">What happened</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.map((item) => {
                const cat = categoryOf(item.action);
                const open = expanded === item.id;
                return (
                  <Fragment key={item.id}>
                    <tr
                      onClick={() => setExpanded(open ? null : item.id)}
                      className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    >
                      <td className="whitespace-nowrap px-4 py-2 text-slate-500 dark:text-slate-400" title={new Date(item.createdAt).toLocaleString()}>
                        {formatRelativeTime(item.createdAt)}
                      </td>
                      <td className="px-4 py-2 text-slate-700 dark:text-slate-200"><ActorCell item={item} /></td>
                      <td className="px-4 py-2">
                        <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${cat.className}`} title={cat.label}>{item.action}</span>
                      </td>
                      <td className="px-4 py-2 text-slate-700 dark:text-slate-200">
                        {item.summary}
                        {item.targetType === 'workflow' && item.targetExists && (
                          <Link
                            to={wp(`/workflows/${item.targetId}`)}
                            onClick={(e) => e.stopPropagation()}
                            className="ml-2 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                          >
                            Open
                          </Link>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-slate-50/60 dark:bg-slate-900/40">
                        <td colSpan={4} className="px-4 py-3"><Diff item={item} /></td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {cursor && !loading && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
