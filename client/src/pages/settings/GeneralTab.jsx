import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { updateWorkspace, deleteWorkspace } from '../../api/workspaces';
import { apiErrorMessage } from '../../api/client';
import { useWorkspaceStore, workspacePath } from '../../store/workspaceStore';
import { useToastStore } from '../../store/toastStore';
import { useCan } from '../../hooks/useCan';
import { confirm } from '../../components/ui/confirm';
import { Card, Button, TextField, ErrorText } from '../../components/ui';

const API_BASE = String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

export default function GeneralTab() {
  const current = useWorkspaceStore((s) => s.current);
  const canUpdate = useCan('workspace:update');
  const canDelete = useCan('workspace:delete');
  const navigate = useNavigate();
  const [name, setName] = useState(current?.name || '');
  const [slug, setSlug] = useState(current?.slug || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sharingError, setSharingError] = useState('');

  if (!current) return null;
  const publicSharing = current.settings?.publicSharing !== false;
  const slugChanged = slug.trim() !== current.slug;
  const dirty = name.trim() !== current.name || slugChanged;

  function applyUpdated(updated) {
    // PATCH returns the workspace; keep the caller's role/permissions if it omits them.
    const merged = { ...current, ...updated };
    const store = useWorkspaceStore.getState();
    store.upsertWorkspace(merged);
    store.setCurrent(merged);
    return merged;
  }

  async function handleSave(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = {};
      if (name.trim() !== current.name) payload.name = name.trim();
      if (slugChanged) payload.slug = slug.trim();
      const merged = applyUpdated(await updateWorkspace(current.id, payload));
      useToastStore.getState().push('Workspace updated.', 'success');
      // The URL names the workspace, so a new slug means a new URL.
      if (slugChanged) navigate(workspacePath(merged.slug, '/settings/general'), { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to update workspace'));
    } finally {
      setBusy(false);
    }
  }

  async function toggleSharing() {
    if (
      publicSharing &&
      !(await confirm({
        title: 'Turn off public sharing?',
        body: 'This revokes every existing share link in this workspace. Turning it back on later does not restore them.',
        confirmLabel: 'Turn off sharing',
        destructive: true,
      }))
    )
      return;
    setSharingError('');
    try {
      applyUpdated(await updateWorkspace(current.id, { settings: { publicSharing: !publicSharing } }));
    } catch (err) {
      setSharingError(apiErrorMessage(err, 'Failed to update sharing'));
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">Workspace</h2>
        <form onSubmit={handleSave} className="space-y-4">
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canUpdate} required />
          <div>
            <TextField
              label="URL slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              disabled={!canUpdate}
              required
            />
            <p className="mt-1 text-xs text-slate-400">
              Lowercase letters, numbers and hyphens. Used in links like <code>/w/{slug || '…'}/dashboard</code>.
            </p>
            {slugChanged && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                Changing the slug changes every URL for this workspace, including event URLs like{' '}
                <code className="break-all">{`${API_BASE}/w/${current.slug}/events/…`}</code>. Old links and integrations
                using the old slug will stop working.
              </p>
            )}
          </div>
          <ErrorText>{error}</ErrorText>
          {canUpdate && (
            <Button type="submit" disabled={busy || !dirty || !name.trim() || !slug.trim()}>
              {busy ? 'Saving...' : 'Save changes'}
            </Button>
          )}
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-400">Public sharing</h2>
        <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
          Lets editors create read-only share links for workflows. Turning it off revokes every existing link at once.
        </p>
        <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={publicSharing}
            onChange={toggleSharing}
            disabled={!canUpdate}
            className="h-4 w-4 accent-brand-500"
          />
          {publicSharing ? 'Share links allowed' : 'Share links disabled'}
        </label>
        <div className="mt-2">
          <ErrorText>{sharingError}</ErrorText>
        </div>
      </Card>

      {canDelete && <DangerZone workspace={current} />}
    </div>
  );
}

function DangerZone({ workspace }) {
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  if (workspace.personal) {
    return (
      <Card className="border-red-200 p-5 dark:border-red-900/60">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-red-500">Danger zone</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Your personal workspace can't be deleted.</p>
      </Card>
    );
  }

  async function handleDelete(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await deleteWorkspace(workspace.id, confirmName);
      const store = useWorkspaceStore.getState();
      store.removeWorkspace(workspace.id);
      const list = await store.refreshWorkspaces().catch(() => store.workspaces);
      const fallback = list.find((w) => w.personal) || list[0];
      useToastStore.getState().push(`Deleted “${workspace.name}”.`, 'success');
      navigate(fallback ? workspacePath(fallback.slug, '/dashboard') : '/');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to delete workspace'));
      setBusy(false);
    }
  }

  return (
    <Card className="border-red-200 p-5 dark:border-red-900/60">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-red-500">Danger zone</h2>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
        Deleting this workspace stops its schedules and permanently removes its workflows, runs, templates and members.
        This can't be undone.
      </p>
      <form onSubmit={handleDelete} className="space-y-3">
        <TextField
          label={`Type “${workspace.name}” to confirm`}
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
        />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="danger" disabled={busy || confirmName !== workspace.name}>
          {busy ? 'Deleting...' : 'Delete workspace'}
        </Button>
      </form>
    </Card>
  );
}
