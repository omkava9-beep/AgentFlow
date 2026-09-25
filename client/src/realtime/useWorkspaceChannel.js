import { useEffect } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { subscribe } from './socket';

/**
 * Keeps the session socket in `workspace:<id>` for the workspace the UI is in,
 * so workspace-scoped pushes (queue stats now; notifications and live
 * analytics later) arrive while any page of it is open. Mounted once by
 * WorkspaceRoute, which remounts on a workspace switch.
 */
export function useWorkspaceChannel() {
  const workspaceId = useWorkspaceStore((s) => s.current?.id);
  useEffect(() => (workspaceId ? subscribe('workspace', workspaceId) : undefined), [workspaceId]);
}
