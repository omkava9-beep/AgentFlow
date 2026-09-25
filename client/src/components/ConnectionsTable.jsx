import { useEffect, useState } from 'react';
import { KeyRound, Link2, MoreHorizontal, Pencil, PlugZap, RefreshCw, Rss, TextCursorInput, Trash2 } from 'lucide-react';
import { DataTable, Menu, MenuButton, MenuSeparator, IntegrationLogo, Avatar, Tooltip } from './ui/index';
import { ConnectionHealth, ConnectionModeBadge } from './connectionBadges';
import { connectionUsage } from '../api/connections';
import { listMembers } from '../api/members';
import { useWorkspaceStore } from '../store/workspaceStore';
import { findIntegration } from '../utils/integrationCatalog';
import { useToastStore } from '../store/toastStore';

/** The API returns `createdBy` as a user id; members give it a name. */
function creator(createdBy, members) {
  if (!createdBy) return null;
  if (typeof createdBy === 'string') {
    const m = members?.[createdBy];
    return m ? { name: m.name || m.email, email: m.email } : { name: 'Former member' };
  }
  return { name: createdBy.name || createdBy.email, email: createdBy.email };
}

/**
 * Every place connections are listed (the Connections page, an integration's
 * Connections tab) renders this one table, so the columns and row actions are
 * identical. Callbacks are optional; an action without one isn't offered.
 */
export default function ConnectionsTable({
  connections, catalog, loading = false, busyId = null, canManage = false, canUse = false,
  onEdit, onTest, onRename, onDelete, onPoll, empty, hideIntegration = false,
}) {
  const [usage, setUsage] = useState({});
  const [members, setMembers] = useState(null);
  const workspaceId = useWorkspaceStore((st) => st.current?.id);
  useEffect(() => {
    if (!workspaceId) return undefined;
    let cancelled = false;
    listMembers(workspaceId)
      .then((list) => { if (!cancelled) setMembers(Object.fromEntries(list.map((m) => [m.userId, m]))); })
      .catch(() => { if (!cancelled) setMembers({}); });
    return () => { cancelled = true; };
  }, [workspaceId]);
  const ids = (connections || []).map((c) => c.id).join(',');

  // "Used by" is per connection; a handful of small requests is fine at this scale.
  useEffect(() => {
    if (!ids) return undefined;
    let cancelled = false;
    Promise.all(ids.split(',').map((id) => connectionUsage(id).then((u) => [id, Array.isArray(u) ? u.length : 0]).catch(() => [id, null])))
      .then((pairs) => { if (!cancelled) setUsage(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [ids]);

  const columns = [
    {
      key: 'name',
      header: 'Connection',
      sortable: true,
      // max-w-0 + w-full lets the name column absorb the slack and truncate,
      // instead of pushing the other columns off the table.
      className: 'max-w-0 w-full',
      sortValue: (c) => c.name.toLowerCase(),
      cell: (c) => {
        const integration = findIntegration(catalog, c.integration);
        return (
          <div className="flex min-w-0 items-center gap-3" data-connection-id={c.id}>
            <IntegrationLogo id={c.integration} name={integration?.name} size="md" />
            <div className="min-w-0">
              <div className="truncate font-medium text-fg">{c.name}</div>
              {!hideIntegration && <div className="truncate text-xs text-subtle">{integration?.name || c.integration}</div>}
            </div>
          </div>
        );
      },
    },
    { key: 'mode', header: 'Mode', sortable: true, width: 120, cell: (c) => <ConnectionModeBadge mode={c.mode} /> },
    {
      key: 'status',
      header: 'Health',
      sortable: true,
      width: 200,
      cell: (c) => (
        <div className="min-w-0">
          {busyId === c.id ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted"><RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Testing…</span>
          ) : c.status === 'error' && c.lastError ? (
            <Tooltip content={c.lastError}><span className="inline-flex"><ConnectionHealth connection={c} /></span></Tooltip>
          ) : (
            <ConnectionHealth connection={c} />
          )}
        </div>
      ),
    },
    {
      key: 'usage',
      header: 'Used by',
      align: 'right',
      width: 130,
      sortable: true,
      sortValue: (c) => usage[c.id] ?? -1,
      cell: (c) => (
        <span className="whitespace-nowrap tabular-nums text-muted">
          {usage[c.id] == null ? '—' : `${usage[c.id]} workflow${usage[c.id] === 1 ? '' : 's'}`}
        </span>
      ),
    },
    {
      key: 'createdBy',
      header: 'Created by',
      width: 170,
      cell: (c) => {
        const who = creator(c.createdBy, members);
        return who ? (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={who.name} email={who.email} size="xs" />
            <span className="truncate text-sm text-muted">{who.name}</span>
          </span>
        ) : <span className="text-subtle">—</span>;
      },
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: 52,
      align: 'right',
      cell: (c) => {
        const integration = findIntegration(catalog, c.integration);
        const canEdit = canManage && integration && onEdit;
        return (
          // Menu clicks mustn't also open the row.
          <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="flex justify-end">
            <Menu
              align="right"
              title={`Actions for ${c.name}`}
              label={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
              buttonClassName="inline-flex h-7 w-7 items-center justify-center rounded-control text-subtle transition-colors hover:bg-bg-subtle hover:text-fg"
              testId={`connection-actions-${c.id}`}
            >
              {canEdit && <MenuButton onClick={() => onEdit(c, integration)}><Pencil className="h-4 w-4" /> Edit{integration?.hasInbound ? ' · inbound URL' : ''}</MenuButton>}
              {canUse && onTest && <MenuButton onClick={() => onTest(c)} disabled={busyId === c.id}><PlugZap className="h-4 w-4" /> Test connection</MenuButton>}
              {canManage && onRename && <MenuButton onClick={() => onRename(c)}><TextCursorInput className="h-4 w-4" /> Rename</MenuButton>}
              {c.inboundUrl && (
                <MenuButton onClick={() => { navigator.clipboard?.writeText(c.inboundUrl); useToastStore.getState().push('Inbound URL copied', 'success'); }}>
                  <Link2 className="h-4 w-4" /> Copy inbound URL
                </MenuButton>
              )}
              {c.integration === 'rss' && onPoll && <MenuButton onClick={() => onPoll(c)}><Rss className="h-4 w-4" /> Check feed now</MenuButton>}
              {canManage && onDelete && (
                <>
                  <MenuSeparator />
                  <MenuButton danger onClick={() => onDelete(c)}><Trash2 className="h-4 w-4" /> Delete</MenuButton>
                </>
              )}
              {!canManage && !canUse && <MenuButton disabled><KeyRound className="h-4 w-4" /> Managed by admins</MenuButton>}
            </Menu>
          </div>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={connections}
      loading={loading}
      loadingRows={4}
      onRowClick={canManage && onEdit ? (c) => { const i = findIntegration(catalog, c.integration); if (i) onEdit(c, i); } : undefined}
      empty={empty}
      initialSort={{ key: 'name', dir: 'asc' }}
    />
  );
}
