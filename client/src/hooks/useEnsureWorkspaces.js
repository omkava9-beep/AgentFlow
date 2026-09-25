import { useEffect, useState } from 'react';
import { listWorkspaces } from '../api/workspaces';
import { useWorkspaceStore } from '../store/workspaceStore';

let inflight = null;

/** Loads the membership list once per session; every caller shares one request. */
export function useEnsureWorkspaces() {
  const loaded = useWorkspaceStore((s) => s.loaded);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const [error, setError] = useState('');

  useEffect(() => {
    if (loaded) return;
    if (!inflight) {
      inflight = listWorkspaces()
        .then((list) => useWorkspaceStore.getState().setWorkspaces(list))
        .finally(() => {
          inflight = null;
        });
    }
    inflight.catch(() => setError('Could not load your workspaces.'));
  }, [loaded]);

  return { loaded, workspaces, error };
}
