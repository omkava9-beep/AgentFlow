import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, Plus, Search, ShieldCheck, TriangleAlert } from 'lucide-react';
import { listConnections, testConnection, deleteConnection, connectionUsage, updateConnection } from '../api/connections';
import { apiErrorMessage } from '../api/client';
import { useIntegrationStore } from '../store/integrationStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useCan } from '../hooks/useCan';
import { useToastStore } from '../store/toastStore';
import ConnectionDialog from '../components/ConnectionDialog';
import ConnectionsTable from '../components/ConnectionsTable';
import ConnectionDeleteDialog from '../components/ConnectionDeleteDialog';
import IntegrationPickerDialog from '../components/IntegrationPickerDialog';
import { PageHeader, Button, Input, Segmented, prompt } from '../components/ui/index';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

const toast = (msg, tone) => useToastStore.getState().push(msg, tone);

export default function Connections() {
  useDocumentTitle('Connections');
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
  const [query, setQuery] = useState('');
  const [modeFilter, setModeFilter] = useState('all');
  const [choosing, setChoosing] = useState(false);
  const [editing, setEditing] = useState(null); // { integration, connection | null }
  const [testing, setTesting] = useState(null);
  const [deleting, setDeleting] = useState(null); // { connection, usage }
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const refresh = useCallback(() => {
    listConnections()
      .then((list) => { setConnections(list); setError(''); })
      .catch((err) => setError(apiErrorMessage(err, 'Failed to load connections')));
  }, []);

  useEffect(() => { loadCatalog(); refresh(); }, [loadCatalog, refresh, workspace?.id]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (connections || []).filter((c) =>
      (modeFilter === 'all' || c.mode === modeFilter || (modeFilter === 'error' && c.status === 'error'))
      && (!q || c.name.toLowerCase().includes(q) || c.integration.toLowerCase().includes(q)));
  }, [connections, query, modeFilter]);

  const counts = useMemo(() => ({
    live: (connections || []).filter((c) => c.mode === 'live').length,
    failing: (connections || []).filter((c) => c.status === 'error').length,
  }), [connections]);

  function saved(connection) {
    setConnections((prev) => [...(prev || []).filter((c) => c.id !== connection.id), connection]);
    upsertInStore(connection);
  }

  async function runTest(connection) {
    setTesting(connection.id);
    try {
      const result = await testConnection(connection.id);
      saved({ ...connection, status: result.status, lastError: result.lastError ?? null, lastTestedAt: new Date().toISOString() });
      toast(result.status === 'ok' ? `${connection.name} works` : `${connection.name}: ${result.lastError || 'test failed'}`, result.status === 'ok' ? 'success' : 'error');
    } catch (err) {
      toast(apiErrorMessage(err, 'Test failed'), 'error');
    } finally {
      setTesting(null);
    }
  }

  async function rename(connection) {
    const name = await prompt({ title: 'Rename connection', label: 'Name', defaultValue: connection.name });
    if (!name || name.trim() === connection.name) return;
    try {
      saved(await updateConnection(connection.id, { name: name.trim() }));
    } catch (err) {
      toast(apiErrorMessage(err, 'Rename failed'), 'error');
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
      toast(`Deleted ${deleting.connection.name}`, 'success');
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

  const hasAny = (connections || []).length > 0;

  return (
    <div>
      <PageHeader
        title="Connections"
        icon={KeyRound}
        description="Stored credentials for integrations. Secrets are encrypted at rest and never shown again after saving."
        actions={canManage && <Button icon={Plus} onClick={() => setChoosing(true)} disabled={!catalog}>New connection</Button>}
      />

      {liveEnabled === false && (
        <div className="mb-4 flex items-start gap-2.5 rounded-card border border-warning/30 bg-warning-subtle px-3.5 py-2.5 text-sm text-warning-subtle-fg">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Live calls are disabled on this server (<code className="font-mono text-xs">INTEGRATIONS_LIVE=false</code>) — every
            node runs in the sandbox, whatever its connection says.
          </span>
        </div>
      )}
      {error && <p className="mb-4 text-sm text-danger" role="alert">{error}</p>}

      {hasAny && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
            <Input placeholder="Search connections…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" aria-label="Search connections" />
          </div>
          <Segmented
            aria-label="Filter connections"
            value={modeFilter}
            onChange={setModeFilter}
            items={[
              { value: 'all', label: `All ${connections.length}` },
              { value: 'live', label: `Live ${counts.live}` },
              { value: 'sandbox', label: `Sandbox ${connections.length - counts.live}` },
              ...(counts.failing ? [{ value: 'error', label: `Failing ${counts.failing}` }] : []),
            ]}
          />
        </div>
      )}

      <ConnectionsTable
        connections={connections ? visible : null}
        catalog={catalog}
        loading={connections === null}
        busyId={testing}
        canManage={canManage}
        canUse={canUse}
        onEdit={(connection, integration) => setEditing({ integration, connection })}
        onTest={runTest}
        onRename={rename}
        onDelete={startDelete}
        empty={hasAny
          ? { icon: Search, title: 'No connections match', body: 'Try another search or filter.', compact: true }
          : {
            icon: ShieldCheck,
            title: 'No connections yet',
            body: canManage
              ? 'A connection stores credentials for a service — encrypted — so integration nodes can call it live.'
              : 'Ask an owner or admin to add one.',
            action: canManage ? <Button icon={Plus} onClick={() => setChoosing(true)} disabled={!catalog}>New connection</Button> : null,
          }}
      />

      {choosing && catalog && (
        <IntegrationPickerDialog
          catalog={catalog}
          onClose={() => setChoosing(false)}
          onPick={(integration) => { setChoosing(false); setEditing({ integration, connection: null }); }}
        />
      )}

      {editing && (
        <ConnectionDialog integration={editing.integration} connection={editing.connection} onClose={() => setEditing(null)} onSaved={saved} />
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
