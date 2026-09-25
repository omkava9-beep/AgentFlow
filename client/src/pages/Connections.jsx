import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listConnections, testConnection, deleteConnection, connectionUsage } from '../api/connections';
import { apiErrorMessage } from '../api/client';
import { useIntegrationStore } from '../store/integrationStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useWorkspacePath } from '../hooks/useWorkspacePath';
import { useCan } from '../hooks/useCan';
import { formatRelativeTime } from '../utils/time';
import { findIntegration, groupByCategory, integrationIcon } from '../utils/integrationCatalog';
import ConnectionDialog from '../components/ConnectionDialog';
import { Button, Card, ErrorText, TextField } from '../components/ui';
import { SkeletonTable } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';

const STATUS = {
  ok: { dot: 'bg-green-500', label: 'Working' },
  error: { dot: 'bg-red-500', label: 'Failing' },
  untested: { dot: 'bg-slate-400', label: 'Untested' },
};

function creatorLabel(createdBy) {
  if (!createdBy) return '—';
  if (typeof createdBy === 'string') return createdBy.slice(-6);
  return createdBy.name || createdBy.email || '—';
}

function Modal({ children, wide = false }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div
        className={`max-h-[85vh] w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900 ${
          wide ? 'max-w-2xl' : 'max-w-md'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/** Step one of "New connection": which integration it's for. */
function IntegrationChooser({ catalog, onPick, onClose }) {
  const [filter, setFilter] = useState('');
  const groups = groupByCategory(catalog, filter);
  return (
    <Modal wide>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">New connection</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
          ✕
        </button>
      </div>
      <TextField placeholder="Search integrations…" value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
      <div className="mt-4 space-y-4">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{group.label}</p>
            <div className="grid grid-cols-2 gap-2">
              {group.items.map((i) => (
                <button
                  key={i.id}
                  onClick={() => onPick(i)}
                  className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-left text-sm hover:border-brand-400 hover:bg-brand-50 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  <span className="text-lg">{integrationIcon(i.icon || i.id)}</span>
                  <span>
                    <span className="block font-medium text-slate-800 dark:text-slate-100">{i.name}</span>
                    <span className="block text-xs text-slate-400">
                      {i.auth?.type === 'none' ? 'No credentials needed' : `Auth: ${i.auth?.type}`}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {!groups.length && <p className="text-sm text-slate-400">No integrations match.</p>}
      </div>
    </Modal>
  );
}

/** Delete confirmation. A connection still in use needs its name typed (spec/25). */
function DeleteDialog({ connection, usage, onConfirm, onClose, busy, error }) {
  const [typed, setTyped] = useState('');
  const wp = useWorkspacePath();
  const inUse = usage.length > 0;
  return (
    <Modal>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Delete {connection.name}?</h3>
      {inUse ? (
        <>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            It&rsquo;s used by {usage.length} workflow{usage.length > 1 ? 's' : ''}. Those nodes will fail with
            &ldquo;Connection not found&rdquo; until they&rsquo;re given another connection.
          </p>
          <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-sm">
            {usage.map((u) => (
              <li key={u.workflowId}>
                <Link to={wp(`/workflows/${u.workflowId}`)} className="text-brand-600 hover:underline dark:text-brand-400">
                  {u.workflowName || u.workflowId}
                </Link>
                <span className="text-xs text-slate-400">
                  {' '}
                  · {(u.nodeIds || []).length} node{(u.nodeIds || []).length === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <TextField
              label={`Type "${connection.name}" to confirm`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">No workflow uses it. This can&rsquo;t be undone.</p>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" disabled={busy || (inUse && typed !== connection.name)} onClick={() => onConfirm(inUse)}>
          {busy ? 'Deleting...' : 'Delete'}
        </Button>
      </div>
    </Modal>
  );
}

export default function Connections() {
  const catalog = useIntegrationStore((s) => s.catalog);
  const liveEnabled = useIntegrationStore((s) => s.liveEnabled);
  const loadCatalog = useIntegrationStore((s) => s.loadCatalog);
  const upsertInStore = useIntegrationStore((s) => s.upsertConnection);
  const removeFromStore = useIntegrationStore((s) => s.removeConnection);
  const workspace = useWorkspaceStore((s) => s.current);
  const canManage = useCan('connections:manage');
  const canUse = useCan('connections:use');

  const [connections, setConnections] = useState(null);
  const [error, setError] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [editing, setEditing] = useState(null); // { integration, connection | null }
  const [testing, setTesting] = useState(null);
  const [deleting, setDeleting] = useState(null); // { connection, usage }
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const refresh = useCallback(() => {
    listConnections()
      .then((list) => {
        setConnections(list);
        setError('');
      })
      .catch((err) => setError(apiErrorMessage(err, 'Failed to load connections')));
  }, []);

  useEffect(() => {
    loadCatalog();
    refresh();
  }, [loadCatalog, refresh, workspace?.id]);

  const sorted = useMemo(
    () => [...(connections || [])].sort((a, b) => a.integration.localeCompare(b.integration) || a.name.localeCompare(b.name)),
    [connections],
  );

  function saved(connection) {
    setConnections((prev) => [...(prev || []).filter((c) => c.id !== connection.id), connection]);
    upsertInStore(connection);
  }

  async function runTest(connection) {
    setTesting(connection.id);
    try {
      const result = await testConnection(connection.id);
      saved({ ...connection, status: result.status, lastError: result.lastError ?? null, lastTestedAt: new Date().toISOString() });
    } catch (err) {
      setError(apiErrorMessage(err, 'Test failed'));
    } finally {
      setTesting(null);
    }
  }

  async function startDelete(connection) {
    setDeleteError('');
    // Usage up front so the dialog can say what breaks; if the endpoint fails,
    // the server's own 409 on a plain DELETE still catches an in-use connection.
    const usage = await connectionUsage(connection.id).catch(() => []);
    setDeleting({ connection, usage: Array.isArray(usage) ? usage : [] });
  }

  async function confirmDelete(force) {
    setDeleteBusy(true);
    setDeleteError('');
    try {
      await deleteConnection(deleting.connection.id, { force });
      setConnections((prev) => prev.filter((c) => c.id !== deleting.connection.id));
      removeFromStore(deleting.connection.id);
      setDeleting(null);
    } catch (err) {
      if (err?.response?.status === 409) {
        // Became referenced since the dialog opened: show the usage and require the typed name.
        setDeleting((d) => ({ ...d, usage: err.response.data?.usage || [] }));
        setDeleteError('This connection is in use — review the list and confirm.');
      } else {
        setDeleteError(apiErrorMessage(err, 'Failed to delete connection'));
      }
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Connections</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Stored credentials for integrations. Secrets are encrypted and never shown again after saving.
          </p>
        </div>
        {canManage && <Button onClick={() => setChoosing(true)}>+ New connection</Button>}
      </div>

      {liveEnabled === false && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
          Live calls are disabled on this server (<code>INTEGRATIONS_LIVE=false</code>) — every node runs in the sandbox,
          whatever its connection says.
        </p>
      )}

      <ErrorText>{error}</ErrorText>

      <Card className="overflow-hidden">
        {connections === null ? (
          <SkeletonTable rows={4} columns={5} />
        ) : !sorted.length ? (
          <div className="p-4">
            <EmptyState
              icon="🔌"
              title="No connections yet"
              body={canManage
                ? 'A connection stores credentials for a service (encrypted), so integration nodes can call it live.'
                : 'Ask an owner or admin to add one.'}
              compact
            />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Mode</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Last tested</th>
                <th className="px-4 py-2 font-medium">Created by</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {sorted.map((c) => {
                const integration = findIntegration(catalog, c.integration);
                const status = STATUS[c.status] || STATUS.untested;
                return (
                  <tr
                    key={c.id}
                    data-connection-id={c.id}
                    onClick={() => canManage && integration && setEditing({ integration, connection: c })}
                    className={canManage ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50' : ''}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{integrationIcon(integration?.icon || c.integration)}</span>
                        <div>
                          <div className="font-medium text-slate-800 dark:text-slate-100">{c.name}</div>
                          <div className="text-xs text-slate-400">{integration?.name || c.integration}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          c.mode === 'live'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {c.mode}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300" title={c.lastError || undefined}>
                        <span className={`h-2 w-2 rounded-full ${status.dot}`} />
                        {status.label}
                      </span>
                      {c.status === 'error' && c.lastError && (
                        <div className="mt-0.5 max-w-[14rem] truncate text-xs text-red-500">{c.lastError}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                      {c.lastTestedAt ? formatRelativeTime(c.lastTestedAt) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{creatorLabel(c.createdBy)}</td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-2">
                        {canUse && (
                          <Button variant="secondary" className="!px-2 !py-1 text-xs" disabled={testing === c.id} onClick={() => runTest(c)}>
                            {testing === c.id ? 'Testing…' : 'Test'}
                          </Button>
                        )}
                        {canManage && (
                          <Button variant="ghost" className="!px-2 !py-1 text-xs text-red-600" onClick={() => startDelete(c)}>
                            Delete
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {choosing && catalog && (
        <IntegrationChooser
          catalog={catalog}
          onClose={() => setChoosing(false)}
          onPick={(integration) => {
            setChoosing(false);
            setEditing({ integration, connection: null });
          }}
        />
      )}

      {editing && (
        <ConnectionDialog
          integration={editing.integration}
          connection={editing.connection}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}

      {deleting && (
        <DeleteDialog
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
