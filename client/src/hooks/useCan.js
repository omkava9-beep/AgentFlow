import { useWorkspaceStore, defaultWorkspace } from '../store/workspaceStore';

/**
 * The client's only view of the permission matrix (spec/23). The server sends
 * the list of actions the caller's role allows as `workspace.permissions`, so
 * the matrix itself lives in exactly one place - server/src/tenancy/permissions.js.
 *
 * A few rules in spec/23 aren't matrix rows but depend on *whose* role is being
 * acted on (admins manage editors/viewers only, only owners invite admins).
 * Those are the one place the client looks at role names, and they stay here so
 * no component compares roles itself. The server enforces all of it regardless.
 */
const ASSIGNABLE_BY = {
  owner: ['owner', 'admin', 'editor', 'viewer'],
  admin: ['editor', 'viewer'],
};

const DERIVED = {
  // Only owners can invite someone straight to admin.
  'members:invite_admin': (ws) => ws.role === 'owner' && ws.permissions?.includes('members:invite'),
};

export function can(workspace, action) {
  if (!workspace) return false;
  if (DERIVED[action]) return DERIVED[action](workspace);
  return Boolean(workspace.permissions?.includes(action));
}

/** `useCan('workflow:edit')` for the current workspace. */
export function useCan(action) {
  // Outside a workspace route (Outbox, Notifications) the nav points at the
  // default workspace, so its permissions decide what the nav shows.
  const current = useWorkspaceStore((s) => s.current || defaultWorkspace(s.workspaces));
  return can(current, action);
}

/** Roles the caller may invite someone as. */
export function invitableRoles(workspace) {
  if (!can(workspace, 'members:invite')) return [];
  return can(workspace, 'members:invite_admin') ? ['admin', 'editor', 'viewer'] : ['editor', 'viewer'];
}

/**
 * What the caller may do to one member row. `selfId` is the signed-in user.
 * Leaving (removing yourself) is offered except to a personal workspace's
 * creator; the server also refuses it for the last owner, with a message the UI shows.
 */
export function memberActions(workspace, member, selfId) {
  const isSelf = member.userId === selfId;
  // The creator of a personal workspace can't leave it (the server says 400).
  // The payload may not carry `createdBy`; its owner is the best stand-in then.
  const personalCreator =
    workspace.personal && (workspace.createdBy ? workspace.createdBy === member.userId : member.role === 'owner');
  const canLeave = isSelf && !personalCreator;
  if (!can(workspace, 'members:manage')) {
    return { canChangeRole: false, canRemove: false, canLeave, roles: [] };
  }
  const roles = ASSIGNABLE_BY[workspace.role] || [];
  // Admins can't touch owners or other admins, and can't change their own role.
  const outranked = workspace.role !== 'owner' && !roles.includes(member.role);
  const lockedSelf = isSelf && workspace.role !== 'owner';
  return {
    canChangeRole: !outranked && !lockedSelf,
    canRemove: !isSelf && !outranked,
    canLeave,
    roles,
  };
}
