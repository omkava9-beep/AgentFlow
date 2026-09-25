import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createWorkspace } from '../api/workspaces';
import { apiErrorMessage } from '../api/client';
import { useWorkspaceStore, workspacePath } from '../store/workspaceStore';
import { Button, TextField, ErrorText } from './ui';

export default function CreateWorkspaceDialog({ onClose }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
      >
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Create workspace</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          A separate space with its own workflows, runs and members. You'll be its owner.
        </p>
        <div className="mt-4 space-y-3">
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc." autoFocus required />
          <ErrorText>{error}</ErrorText>
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={busy || !name.trim()}>
              {busy ? 'Creating...' : 'Create'}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
