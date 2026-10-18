import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';
import { updateWorkspace, deleteWorkspace } from '../../api/workspaces';
import { apiErrorMessage, API_BASE_URL } from '../../api/client';
import { useWorkspaceStore, workspacePath } from '../../store/workspaceStore';
import { useToastStore } from '../../store/toastStore';
import { useCan } from '../../hooks/useCan';
import { Button, Field, Input, Switch, confirm } from '../../components/ui/index';
import SettingsCard from './SettingsCard';

const API_BASE = API_BASE_URL;
const APP_ORIGIN = typeof window !== 'undefined' ? window.location.origin : '';

export default function GeneralTab() {
  const current = useWorkspaceStore((s) => s.current);
  const canUpdate = useCan('workspace:update');
  const canDelete = useCan('workspace:delete');
  const navigate = useNavigate();
  const [name, setName] = useState(current?.name || '');
  const [slug, setSlug] = useState(current?.slug || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sharingBusy, setSharingBusy] = useState(false);
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
    e?.preventDefault();
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

  async function toggleSharing(next) {
    if (
      !next &&
      !(await confirm({
        title: 'Turn off public sharing?',
        body: 'This revokes every existing share link in this workspace. Turning it back on later does not restore them.',
        confirmLabel: 'Turn off sharing',
        destructive: true,
      }))
    )
      return;
    setSharingError('');
    setSharingBusy(true);
    try {
      applyUpdated(await updateWorkspace(current.id, { settings: { publicSharing: next } }));
    } catch (err) {
      setSharingError(apiErrorMessage(err, 'Failed to update sharing'));
    } finally {
      setSharingBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <form onSubmit={handleSave}>
        <SettingsCard
          title="Workspace"
          description="The name everyone sees, and the slug in this workspace's URLs."
          footer={canUpdate && (
            <>
              {dirty && <span className="mr-auto text-xs text-subtle">Unsaved changes</span>}
              <Button type="submit" loading={busy} disabled={!dirty || !name.trim() || !slug.trim()}>Save changes</Button>
            </>
          )}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required htmlFor="ws-name">
              <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canUpdate} />
            </Field>
            <Field label="URL slug" required htmlFor="ws-slug" help="Lowercase letters, numbers and hyphens.">
              <div className="flex">
                <span className="inline-flex h-8 items-center rounded-l-control border border-r-0 border-default bg-bg-subtle px-2.5 font-mono text-xs text-subtle">
                  /w/
                </span>
                <Input
                  id="ws-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  disabled={!canUpdate}
                  className="rounded-l-none font-mono"
                />
              </div>
            </Field>
          </div>
          {slugChanged && (
            <div className="mt-4 flex items-start gap-2.5 rounded-card border border-warning/30 bg-warning-subtle px-3.5 py-2.5 text-sm text-warning-subtle-fg">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                Changing the slug changes every URL for this workspace — links like{' '}
                <code className="font-mono text-xs">{`${APP_ORIGIN}/w/${current.slug}/…`}</code> and event URLs like{' '}
                <code className="break-all font-mono text-xs">{`${API_BASE}/w/${current.slug}/events/…`}</code>. Old links and
                integrations using the old slug will stop working.
              </p>
            </div>
          )}
          {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
        </SettingsCard>
      </form>

      <SettingsCard title="Public sharing" description="Read-only share links let people outside the workspace view a workflow.">
        <Switch
          checked={publicSharing}
          onChange={toggleSharing}
          disabled={!canUpdate || sharingBusy}
          label={publicSharing ? 'Share links allowed' : 'Share links disabled'}
          description="Turning this off revokes every existing link at once."
          data-testid="public-sharing-switch"
        />
        {sharingError && <p className="mt-3 text-sm text-danger" role="alert">{sharingError}</p>}
      </SettingsCard>

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
      <SettingsCard danger title="Danger zone">
        <p className="text-sm text-muted">Your personal workspace can&rsquo;t be deleted.</p>
      </SettingsCard>
    );
  }

  async function handleDelete(e) {
    e?.preventDefault();
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
    <form onSubmit={handleDelete}>
      <SettingsCard
        danger
        title="Danger zone"
        description="Deleting this workspace stops its schedules and permanently removes its workflows, runs, templates, connections and members. This can't be undone."
        footer={<Button type="submit" variant="danger" loading={busy} disabled={confirmName !== workspace.name}>Delete workspace</Button>}
      >
        <Field label={<>Type <span className="font-mono">{workspace.name}</span> to confirm</>} htmlFor="ws-delete-confirm">
          <Input id="ws-delete-confirm" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" className="max-w-sm" />
        </Field>
        {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
      </SettingsCard>
    </form>
  );
}
