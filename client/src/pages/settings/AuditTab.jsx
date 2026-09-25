import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Bot, Download, ExternalLink, FilterX, KeyRound, ScrollText } from 'lucide-react';
import { listAudit, downloadAuditCsv } from '../../api/audit';
import { listMembers } from '../../api/members';
import { apiErrorMessage } from '../../api/client';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useWorkspacePath } from '../../hooks/useWorkspacePath';
import { useCan } from '../../hooks/useCan';
import { formatRelativeTime } from '../../utils/time';
import {
  Avatar, Badge, Button, Combobox, DataTable, DateRangePicker, Drawer, EmptyState, Select, Tooltip,
} from '../../components/ui/index';

// Tone by what kind of access the action changed (spec/34 UI).
const CATEGORIES = [
  { key: 'members', label: 'Members', prefixes: ['member.', 'invitation.'], tone: 'info' },
  { key: 'access', label: 'Access', prefixes: ['apikey.', 'share.'], tone: 'warning' },
  { key: 'connections', label: 'Connections', prefixes: ['connection.'], tone: 'success' },
  { key: 'workflows', label: 'Workflows', prefixes: ['workflow.', 'trigger.', 'webhook.', 'template.'], tone: 'accent' },
  { key: 'workspace', label: 'Workspace', prefixes: ['workspace.'], tone: 'neutral' },
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
const TARGET_LABELS = { apiKey: 'API key' };

// Date filters are local calendar days; the API wants instants.
const dayStart = (d) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);
const dayEnd = (d) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined);

/** Summaries lead with the actor, who already has a column: drop that prefix. */
function summaryText(item) {
  const text = item.summary || '';
  const who = item.actorLabel;
  if (who && text.startsWith(`${who} `)) {
    const rest = text.slice(who.length + 1);
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  return text;
}

const show = (value) => {
  if (value === '[redacted]') return '••••';
  if (value === null || value === undefined) return '—';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

function ActorCell({ item }) {
  if (item.actorType === 'apiKey') {
    return <span className="inline-flex items-center gap-2 text-sm"><KeyRound className="h-4 w-4 text-subtle" aria-hidden="true" />{item.actorLabel}</span>;
  }
  if (item.actorType === 'system') {
    return <span className="inline-flex items-center gap-2 text-sm text-muted"><Bot className="h-4 w-4 text-subtle" aria-hidden="true" />{item.actorLabel}</span>;
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-2 text-sm">
      <Avatar name={item.actorLabel} size="xs" />
      <span className="truncate">
        {item.actorLabel}
        {item.actorIsMember === false && <span className="ml-1 text-xs text-subtle">(no longer a member)</span>}
      </span>
    </span>
  );
}

/** before → after, field by field; redacted values show that a field changed, not to what. */
function Diff({ item }) {
  const keys = [...new Set([...Object.keys(item.before || {}), ...Object.keys(item.after || {})])];
  const meta = item.meta && Object.keys(item.meta).length ? item.meta : null;
  if (!keys.length && !meta) return <p className="text-sm text-subtle">No field details recorded.</p>;
  return (
    <div className="space-y-4">
      {keys.length > 0 && (
        <div className="overflow-hidden rounded-card border border-default">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_16px_minmax(0,1.3fr)] gap-2 border-b border-default bg-bg-subtle/70 px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-subtle">
            <span>Field</span><span>Before</span><span /><span>After</span>
          </div>
          {keys.map((k) => (
            <div key={k} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_16px_minmax(0,1.3fr)] items-start gap-2 border-b border-default px-3 py-2 font-mono text-xs last:border-0">
              <span className="truncate text-muted">{k}</span>
              <span className="break-all text-danger line-through decoration-danger/40">{show(item.before?.[k])}</span>
              <ArrowRight className="mt-0.5 h-3 w-3 text-subtle" aria-hidden="true" />
              <span className="break-all text-success">{show(item.after?.[k])}</span>
            </div>
          ))}
        </div>
      )}
      {meta && (
        <dl className="space-y-1 text-xs">
          {Object.entries(meta).map(([k, v]) => (
            <div key={k} className="flex gap-2 font-mono">
              <dt className="text-subtle">{k}</dt>
              <dd className="break-all text-fg">{show(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export default function AuditTab() {
  const current = useWorkspaceStore((s) => s.current);
  const allowed = useCan('audit:read');
  const wp = useWorkspacePath();
  const [items, setItems] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [members, setMembers] = useState([]);
  // "View log" links from other tabs arrive pre-filtered (?action=member.*).
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState(() => ({
    action: ACTION_FILTERS.some(([v]) => v === searchParams.get('action')) ? searchParams.get('action') : '',
    actor: '', targetType: '', from: '', to: '',
  }));

  // The actor filter mixes members (by id) with the two non-user actor types.
  const query = useCallback(() => {
    const q = { action: filters.action, targetType: filters.targetType, from: dayStart(filters.from), to: dayEnd(filters.to) };
    if (filters.actor === 'apiKey' || filters.actor === 'system') q.actorType = filters.actor;
    else if (filters.actor) q.actorId = filters.actor;
    return q;
  }, [filters]);

  const load = useCallback(async () => {
    if (!current || !allowed) return;
    setItems(null);
    setError('');
    try {
      const page = await listAudit(current.id, query());
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load the audit log'));
      setItems([]);
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

  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  const filtered = Object.values(filters).some(Boolean);

  const actorOptions = useMemo(() => [
    // Grouped throughout: the Combobox treats every top-level entry as a group
    // once any of them is one.
    { label: '', options: [{ value: '', label: 'Anyone' }] },
    { label: 'Members', options: members.map((m) => ({ value: m.userId, label: m.name || m.email, description: m.name ? m.email : undefined, keywords: [m.email] })) },
    { label: 'Other', options: [{ value: 'apiKey', label: 'API keys', icon: KeyRound }, { value: 'system', label: 'System', icon: Bot }] },
  ], [members]);

  if (!allowed) {
    return <EmptyState icon={ScrollText} title="Owners and admins only" body="Only owners and admins can read the audit log." compact />;
  }

  const columns = [
    {
      key: 'createdAt',
      header: 'When',
      width: 130,
      cell: (item) => (
        <Tooltip content={new Date(item.createdAt).toLocaleString()}>
          <span className="whitespace-nowrap text-sm text-subtle">{formatRelativeTime(item.createdAt)}</span>
        </Tooltip>
      ),
    },
    { key: 'actor', header: 'Actor', width: 190, cell: (item) => <ActorCell item={item} /> },
    {
      key: 'action',
      header: 'Action',
      width: 190,
      cell: (item) => <Badge tone={categoryOf(item.action).tone} size="xs" className="font-mono">{item.action}</Badge>,
    },
    {
      key: 'summary',
      header: 'What happened',
      className: 'max-w-0 w-full',
      cell: (item) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="line-clamp-2 text-sm text-fg">{summaryText(item)}</span>
          {item.targetType === 'workflow' && item.targetExists && (
            <Link
              to={wp(`/workflows/${item.targetId}`)}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-accent hover:underline"
            >
              Open <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </Link>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-fg">Audit log</h2>
          <p className="mt-0.5 max-w-2xl text-sm text-muted">
            Who changed members, access, connections, sharing and triggers in this workspace. Entries can&rsquo;t be edited or deleted.
          </p>
        </div>
        <Button variant="secondary" icon={Download} onClick={exportCsv} disabled={items === null}>Export CSV</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <div className="w-40"><Select
          aria-label="Action"
          size="sm"
          value={filters.action}
          onValueChange={(v) => setFilter('action', v)}
          options={ACTION_FILTERS.map(([value, label]) => ({ value, label }))}
        /></div>
        <div className="w-52"><Combobox
          aria-label="Actor"
          size="sm"
          value={filters.actor}
          onChange={(v) => setFilter('actor', v || '')}
          options={actorOptions}
          placeholder="Anyone"
          searchPlaceholder="Search people…"
        /></div>
        <div className="w-40"><Select
          aria-label="Target"
          size="sm"
          value={filters.targetType}
          onValueChange={(v) => setFilter('targetType', v)}
          options={[{ value: '', label: 'Any target' }, ...TARGET_TYPES.map((t) => ({ value: t, label: TARGET_LABELS[t] || t[0].toUpperCase() + t.slice(1) }))]}
        /></div>
        <div className="w-60"><DateRangePicker
          aria-label="Date range"
          value={{ from: filters.from, to: filters.to }}
          onChange={(r) => setFilters((f) => ({ ...f, from: r?.from || '', to: r?.to || '' }))}
        /></div>
        {filtered && (
          <Button variant="ghost" size="sm" icon={FilterX} onClick={() => setFilters({ action: '', actor: '', targetType: '', from: '', to: '' })}>
            Clear
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      <DataTable
        columns={columns}
        rows={items}
        loading={items === null}
        onRowClick={(item) => setOpen(item)}
        empty={filtered
          ? { icon: FilterX, title: 'No entries match these filters', body: 'Try a wider date range or another action.', compact: true }
          : { icon: ScrollText, title: 'No administrative activity yet', body: 'Changes to members, keys, connections and sharing will appear here.', compact: true }}
        footer={cursor && items?.length ? (
          <div className="flex justify-center">
            <Button variant="ghost" size="sm" loading={loadingMore} onClick={loadMore}>Load more</Button>
          </div>
        ) : null}
      />

      <Drawer
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        title={open?.summary || 'Audit entry'}
        description={open ? `${new Date(open.createdAt).toLocaleString()}${open.ip ? ` · IP ${open.ip}` : ''}` : undefined}
        width="w-[480px]"
      >
        {open && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={categoryOf(open.action).tone} className="font-mono">{open.action}</Badge>
              <ActorCell item={open} />
            </div>
            {open.targetType && (
              <p className="text-sm text-muted">
                Target: <span className="text-fg">{TARGET_LABELS[open.targetType] || open.targetType}</span>
                {open.targetLabel && <> · <span className="text-fg">{open.targetLabel}</span></>}
              </p>
            )}
            <Diff item={open} />
          </div>
        )}
      </Drawer>
    </div>
  );
}
