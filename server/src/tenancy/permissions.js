/**
 * The one permission matrix (spec/23). Controllers ask `requirePermission(action)`;
 * the client renders from `permissionsFor(role)` sent by the server. Nothing else
 * in the codebase compares role names - later specs add rows here instead.
 */
export const ROLES = ['owner', 'admin', 'editor', 'viewer'];

const ALL = ['owner', 'admin', 'editor', 'viewer'];
const EDITORS = ['owner', 'admin', 'editor'];
const ADMINS = ['owner', 'admin'];
const OWNERS = ['owner'];

export const PERMISSIONS = {
  'workflow:read': ALL,
  'workflow:edit': EDITORS,
  'workflow:run': EDITORS,
  'triggers:manage': EDITORS,
  'share:manage': EDITORS,
  'templates:create': EDITORS,
  'templates:use': EDITORS,
  'members:read': ALL,
  'members:invite': ADMINS,
  // Admins are further limited to editors/viewers; that rule lives with the
  // members controller (spec/23 footnote 1), not in this table.
  'members:manage': ADMINS,
  'workspace:update': ADMINS,
  'workspace:delete': OWNERS,
  'apiKeys:manage': ADMINS,
  'connections:manage': ADMINS,
  'connections:use': EDITORS,
  'audit:read': ADMINS,
  'workflow:publish': EDITORS,
  'code:author': ADMINS,
  // Deciding an approval you're assigned to - even a viewer can be an approver.
  'runs:approve': ALL,
  'runs:approve_any': ADMINS,
  'comments:write': ALL,
  'comments:moderate': ADMINS,
  'workspace:billing': OWNERS,
};

export function can(role, action) {
  return Boolean(PERMISSIONS[action]?.includes(role));
}

export function permissionsFor(role) {
  return Object.keys(PERMISSIONS).filter((action) => can(role, action)).sort();
}
