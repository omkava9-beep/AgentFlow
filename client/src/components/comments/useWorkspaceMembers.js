import { useEffect, useState } from 'react';
import { listMembers } from '../../api/members';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { on } from '../../realtime/socket';

// Cached for the session per workspace (spec/29 §3); refetched on a role change.
const cache = new Map();

export function useWorkspaceMembers() {
  const workspaceId = useWorkspaceStore((s) => s.current?.id);
  const [members, setMembers] = useState(() => cache.get(workspaceId) || []);

  useEffect(() => {
    if (!workspaceId) return undefined;
    let cancelled = false;
    const load = (force = false) => {
      if (!force && cache.has(workspaceId)) {
        setMembers(cache.get(workspaceId));
        return;
      }
      listMembers(workspaceId)
        .then((list) => {
          cache.set(workspaceId, list);
          if (!cancelled) setMembers(list);
        })
        .catch(() => {});
    };
    load();
    const off = on('workspace:role_changed', () => load(true));
    return () => {
      cancelled = true;
      off();
    };
  }, [workspaceId]);

  return members;
}
