import Membership from '../models/Membership.js';
import User from '../models/User.js';
import { HttpError } from '../middleware/errorHandler.js';
import { ROLES, can, permissionsFor } from '../tenancy/permissions.js';
import { isValidObjectId } from '../tenancy/scoped.js';
import { emitToUser, evictFromWorkspace } from '../sockets/rooms.js';
import { hub } from '../collab/hub.js';
import Workspace from '../models/Workspace.js';
import { notify } from './notify.js';

/**
 * The rules for changing who is in a workspace (spec/23 §1, §4). The matrix says
 * *whether* a role may manage members at all; these functions hold the finer
 * rules the matrix can't express: admins only touch editors and viewers, and a
 * workspace never loses its last owner.
 */

const LAST_OWNER = 'A workspace needs at least one owner. Promote someone else first.';
const ADMIN_LIMITED = new Set(['editor', 'viewer']);

export async function listMembers(workspaceId) {
  const memberships = await Membership.find({ workspaceId }).sort({ createdAt: 1 });
  const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) } }).select('email name');
  const byId = new Map(users.map((u) => [u._id.toString(), u]));
  return memberships
    .filter((m) => byId.has(m.userId.toString()))
    .map((m) => {
      const user = byId.get(m.userId.toString());
      return { userId: user._id.toString(), email: user.email, name: user.name || '', role: m.role, joinedAt: m.createdAt };
    });
}

async function findMember(workspaceId, userId) {
  if (!isValidObjectId(userId)) throw new HttpError(404, 'Member not found');
  const membership = await Membership.findOne({ workspaceId, userId });
  if (!membership) throw new HttpError(404, 'Member not found');
  return membership;
}

function otherOwners(workspaceId, userId) {
  return Membership.countDocuments({ workspaceId, role: 'owner', userId: { $ne: userId } });
}

/**
 * The count check above can race (two owners demoting each other at once), so
 * after writing we look again and undo our own change if it left nobody in
 * charge. Cheap, and there are no transactions on a standalone MongoDB.
 */
async function assertOwnerRemains(workspaceId, undo) {
  if (await Membership.countDocuments({ workspaceId, role: 'owner' })) return;
  await undo();
  throw new HttpError(400, LAST_OWNER);
}

export async function changeRole({ actor, workspaceId, targetUserId, role }) {
  if (!ROLES.includes(role)) throw new HttpError(400, `Role must be one of: ${ROLES.join(', ')}`);
  const target = await findMember(workspaceId, targetUserId);
  const isSelf = target.userId.toString() === actor.userId.toString();

  if (actor.role === 'admin') {
    // spec/23 footnote 1: admins manage editors and viewers only, never promote
    // past editor, and never change their own role.
    if (isSelf || !ADMIN_LIMITED.has(target.role) || !ADMIN_LIMITED.has(role)) {
      throw new HttpError(403, "You don't have permission to do that");
    }
  }

  if (target.role === role) return target;
  if (target.role === 'owner' && !(await otherOwners(workspaceId, target.userId))) {
    throw new HttpError(400, LAST_OWNER);
  }

  const previous = target.role;
  target.role = role;
  await target.save();
  await assertOwnerRemains(workspaceId, () => Membership.updateOne({ _id: target._id }, { $set: { role: previous } }));

  // The affected user's open sessions flip live (read-only on demotion, etc.).
  emitToUser(target.userId.toString(), 'workspace:role_changed', {
    workspaceId: workspaceId.toString(),
    role,
    permissions: permissionsFor(role),
  });
  // Open collaboration sessions pick up the new role; a demoted editor's
  // soft locks are released and their ops rejected from now on (spec/28 §5).
  hub.onRoleChanged(target.userId.toString(), workspaceId.toString(), role);

  const workspace = await Workspace.findById(workspaceId).select('name slug').lean();
  await notify([target.userId], {
    workspaceId,
    kind: 'role_changed',
    title: `You're now ${/^[aeiou]/.test(role) ? 'an' : 'a'} ${role} in ${workspace?.name || 'a workspace'}`,
    body: `Changed from ${previous}.`,
    link: workspace ? `/w/${workspace.slug}/dashboard` : '',
    actorId: actor.userId,
  });
  return target;
}

/**
 * Removing someone else needs `members:manage` (plus the admin limits); removing
 * yourself is leaving, which every member may do - except the last owner, and
 * the creator of a personal workspace, who would otherwise strand their own
 * default workspace.
 */
export async function removeMember({ actor, workspace, targetUserId }) {
  const workspaceId = workspace._id;
  const target = await findMember(workspaceId, targetUserId);
  const isSelf = target.userId.toString() === actor.userId.toString();

  if (isSelf) {
    if (workspace.personal && workspace.createdBy?.toString() === target.userId.toString()) {
      throw new HttpError(400, "You can't leave your personal workspace");
    }
  } else {
    if (!can(actor.role, 'members:manage')) throw new HttpError(403, "You don't have permission to do that");
    if (actor.role === 'admin' && !ADMIN_LIMITED.has(target.role)) {
      throw new HttpError(403, "You don't have permission to do that");
    }
  }

  if (target.role === 'owner' && !(await otherOwners(workspaceId, target.userId))) {
    throw new HttpError(400, LAST_OWNER);
  }

  const snapshot = target.toObject();
  await target.deleteOne();
  await assertOwnerRemains(workspaceId, () => Membership.create(snapshot));

  // Kicks their sockets out of every room in this workspace and tells the client.
  evictFromWorkspace(target.userId.toString(), workspaceId.toString());
  hub.evictUser(target.userId.toString(), workspaceId.toString());
}
