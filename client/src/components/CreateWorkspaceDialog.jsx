import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { createWorkspace } from '../api/workspaces';
import { apiErrorMessage } from '../api/client';
import { useWorkspaceStore, workspacePath } from '../store/workspaceStore';
import { Button, Dialog, Field, Input } from './ui/index';

export default function CreateWorkspaceDialog({ onClose }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e?.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const ws = await createWorkspace(name.trim());
      useWorkspaceStore.getState().upsertWorkspace(ws);
      onClose();
      navigate(workspacePath(ws.slug, '/dashboard'));
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to create workspace'));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!busy}
      size="sm"
      icon={Building2}
      title="Create workspace"
      description="A separate space with its own workflows, runs, connections and members. You'll be its owner."
      testId="create-workspace-dialog"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form="create-workspace-form" loading={busy} disabled={!name.trim()}>Create</Button>
        </>
      )}
    >
      <form id="create-workspace-form" onSubmit={handleSubmit}>
        <Field label="Name" required htmlFor="new-ws-name" error={error || undefined}>
          <Input id="new-ws-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc." autoFocus />
        </Field>
      </form>
    </Dialog>
  );
}
