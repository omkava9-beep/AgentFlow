import mongoose from 'mongoose';
import Notification from '../models/Notification.js';
import Membership from '../models/Membership.js';
import Workspace from '../models/Workspace.js';
import User from '../models/User.js';
import { isValidObjectId } from '../tenancy/scoped.js';
import { emitToUser } from '../sockets/rooms.js';

/**
 * The one way anything in the app tells a person something (spec/29 §4).
 *
 *   notify(userIds, { workspaceId, kind, title, body, link, actorId, groupKey?, allowNonMember? })
 *
 * 1. Drops the actor (nobody is notified about their own action) and anyone who
 *    isn't a member of `workspaceId`. `allowNonMember` is honoured for `invite`
 *    only: the invitee isn't a member yet, and no other kind has that excuse.
 * 2. Persists one Notification per recipient - or, with a `groupKey`, bumps the
 *    recipient's existing *unread* row for that key instead (count + 1, newest
 *    title/body/link), so a schedule failing every minute is one row, not sixty.
 * 3. Pushes `notification:new` (the row plus the recipient's unreadCount) to
 *    each `user:<id>` room.
 *
 * Returns the notifications written or bumped. Never throws: a notification is
 * a side effect, and a failure to record one must not fail the action that
 * caused it.
 */
export async function notify(userIds, payload) {
  try {
    return await deliver(userIds, payload);
  } catch (err) {
    console.error('[notify] failed:', err.message);
    return [];
  }
}

async function deliver(userIds, payload) {
  const {
    workspaceId = null, kind, title, body = '', link = '', actorId = null, groupKey = null, allowNonMember = false,
  } = payload || {};
  if (!kind || !title) throw new Error('notify() needs a kind and a title');

  const actor = actorId ? String(actorId) : null;
  let recipients = [...new Set((userIds || []).filter(Boolean).map(String))]
    .filter((id) => isValidObjectId(id) && id !== actor);
  if (!recipients.length) return [];

  if (!(allowNonMember && kind === 'invite')) {
    if (!workspaceId) return [];
    const members = await Membership.find({ workspaceId, userId: { $in: recipients } }).select('userId').lean();
    const memberIds = new Set(members.map((m) => String(m.userId)));
    recipients = recipients.filter((id) => memberIds.has(id));
  }

  const now = new Date();
  const written = [];
  for (const userId of recipients) {
    let doc = null;
    if (groupKey) {
      doc = await Notification.findOneAndUpdate(
        { userId, groupKey, readAt: null },
        { $inc: { count: 1 }, $set: { title, body, link, actorId: actor, lastAt: now } },
        { returnDocument: 'after' },
      );
    }
    if (!doc) {
      doc = await Notification.create({ workspaceId, userId, kind, title, body, link, actorId: actor, groupKey, lastAt: now });
    }
    written.push(doc);
  }

  const presented = await presentNotifications(written);
  for (const n of presented) {
    emitToUser(n.userId, 'notification:new', { ...n, unreadCount: await unreadCountFor(n.userId) });
  }
  return presented;
}

/**
 * What a user can see: their own rows, from workspaces they're still in -
 * plus invites, which by definition come from a workspace they haven't joined.
 * Rows from a workspace they left are hidden, not deleted, and come back if
 * they rejoin (spec/29 edge cases).
 */
export async function visibleFilter(userId, extra = {}) {
  const memberships = await Membership.find({ userId }).select('workspaceId').lean();
  return {
    userId: new mongoose.Types.ObjectId(String(userId)),
    $or: [{ workspaceId: { $in: memberships.map((m) => m.workspaceId) } }, { kind: 'invite' }],
    ...extra,
  };
}

export async function unreadCountFor(userId) {
  return Notification.countDocuments(await visibleFilter(userId, { readAt: null }));
}

/** Adds the workspace's name/slug and the actor's name, which rows display. */
export async function presentNotifications(docs) {
  const wsIds = [...new Set(docs.map((d) => d.workspaceId && String(d.workspaceId)).filter(Boolean))];
  const actorIds = [...new Set(docs.map((d) => d.actorId && String(d.actorId)).filter(Boolean))];
  const [workspaces, actors] = await Promise.all([
    wsIds.length ? Workspace.find({ _id: { $in: wsIds } }).select('name slug').lean() : [],
    actorIds.length ? User.find({ _id: { $in: actorIds } }).select('name email').lean() : [],
  ]);
  const wsById = new Map(workspaces.map((w) => [String(w._id), w]));
  const actorById = new Map(actors.map((u) => [String(u._id), u]));
  return docs.map((d) => {
    const ws = d.workspaceId && wsById.get(String(d.workspaceId));
    const actor = d.actorId && actorById.get(String(d.actorId));
    return {
      id: String(d._id),
      userId: String(d.userId),
      workspaceId: d.workspaceId ? String(d.workspaceId) : null,
      workspace: ws ? { name: ws.name, slug: ws.slug } : null,
      kind: d.kind,
      title: d.title,
      body: d.body,
      link: d.link,
      actor: actor ? { id: String(actor._id), name: actor.name || actor.email } : null,
      groupKey: d.groupKey,
      count: d.count,
      readAt: d.readAt,
      createdAt: d.createdAt,
      lastAt: d.lastAt,
    };
  });
}
