import { listMembers, changeRole, removeMember } from '../services/membershipService.js';
import { audit } from '../services/audit.js';

export async function list(req, res, next) {
  try {
    res.json(await listMembers(req.workspaceId));
  } catch (err) {
    next(err);
  }
}

const findIn = (members, userId) => members.find((m) => m.userId === userId);

export async function update(req, res, next) {
  try {
    const before = findIn(await listMembers(req.workspaceId), req.params.userId);
    await changeRole({
      actor: req.membership,
      workspaceId: req.workspace._id,
      targetUserId: req.params.userId,
      role: req.body?.role,
    });
    const member = findIn(await listMembers(req.workspaceId), req.params.userId);
    if (before && member && before.role !== member.role) {
      await audit(req, 'member.role_changed', { type: 'member', id: member.userId, name: member.email },
        { before: { role: before.role }, after: { role: member.role } });
    }
    res.json(member);
  } catch (err) {
    next(err);
  }
}

/** Also how a member leaves: DELETE on your own userId. */
export async function remove(req, res, next) {
  try {
    const before = findIn(await listMembers(req.workspaceId), req.params.userId);
    await removeMember({ actor: req.membership, workspace: req.workspace, targetUserId: req.params.userId });
    const isSelf = req.params.userId === String(req.userId);
    await audit(req, isSelf ? 'member.left' : 'member.removed',
      { type: 'member', id: req.params.userId, name: before?.email },
      { before: before ? { role: before.role } : null });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
