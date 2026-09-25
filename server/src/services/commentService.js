import CommentThread from '../models/CommentThread.js';
import Comment, { MAX_COMMENT_LENGTH } from '../models/Comment.js';
import Membership from '../models/Membership.js';
import User from '../models/User.js';
import Workspace from '../models/Workspace.js';
import { HttpError } from '../middleware/errorHandler.js';
import { getIo } from '../sockets/ioInstance.js';
import { hub } from '../collab/hub.js';
import { notify } from './notify.js';
import { autoWatch } from './watchService.js';

/**
 * Comment threads, mentions and their live sync (spec/29 §1–3). Controllers
 * stay thin; everything that decides who gets told what lives here.
 */

const MENTION_TOKEN = /\{\{@([a-f0-9]{24})\}\}/g;

function io() {
  try {
    return getIo();
  } catch {
    return null;
  }
}

/** Same room collaboration uses (spec/24 `workflow:<id>`); every payload names its workflow. */
export function emitToWorkflow(workflowId, event, payload) {
  io()?.to(`workflow:${workflowId}`).emit(event, { workflowId: String(workflowId), ...payload });
}

export function cleanBody(raw) {
  const body = typeof raw === 'string' ? raw.trim() : '';
  if (!body) throw new HttpError(400, 'A comment needs some text');
  if (body.length > MAX_COMMENT_LENGTH) throw new HttpError(400, `Comments are limited to ${MAX_COMMENT_LENGTH} characters`);
  return body;
}

/**
 * Mentions are accepted for current members only (spec/29 §3). A token naming
 * anyone else - a stale autocomplete pick, or a crafted id - is rewritten to
 * plain text, so it can neither notify them nor render as a mention later.
 */
export async function resolveMentions(workspaceId, body) {
  const ids = [...new Set([...body.matchAll(MENTION_TOKEN)].map((m) => m[1]))];
  if (!ids.length) return { body, mentions: [] };
  const members = await Membership.find({ workspaceId, userId: { $in: ids } }).select('userId').lean();
  const valid = new Set(members.map((m) => String(m.userId)));
  return {
    body: body.replace(MENTION_TOKEN, (token, id) => (valid.has(id) ? token : '@someone')),
    mentions: ids.filter((id) => valid.has(id)),
  };
}

/** Plain-text preview for a notification: tokens become names. */
async function preview(body) {
  const ids = [...new Set([...body.matchAll(MENTION_TOKEN)].map((m) => m[1]))];
  const users = ids.length ? await User.find({ _id: { $in: ids } }).select('name email').lean() : [];
  const nameOf = new Map(users.map((u) => [String(u._id), u.name || u.email]));
  const text = body.replace(MENTION_TOKEN, (_, id) => `@${nameOf.get(id) || 'someone'}`);
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

/** The node ids of the workflow as it is right now - the live draft if a session is open. */
function currentNodeIds(workflow) {
  const nodes = hub.getDraft(workflow._id)?.nodes ?? workflow.nodes ?? [];
  return new Set(nodes.map((n) => n.id));
}

export function validateAnchor(workflow, anchor) {
  if (!anchor || typeof anchor !== 'object') throw new HttpError(400, 'An anchor is required');
  if (anchor.type === 'node') {
    const nodeId = typeof anchor.nodeId === 'string' ? anchor.nodeId : '';
    // Someone may have deleted the node a moment ago: 409, so the client can
    // re-offer the text as a canvas comment at the same spot.
    if (!nodeId || !currentNodeIds(workflow).has(nodeId)) {
      const err = new HttpError(409, 'That node no longer exists');
      err.code = 'node_missing';
      throw err;
    }
    return { type: 'node', nodeId, x: null, y: null, detached: false };
  }
  if (anchor.type === 'canvas') {
    const x = Number(anchor.x);
    const y = Number(anchor.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new HttpError(400, 'A canvas anchor needs numeric x and y');
    return { type: 'canvas', nodeId: null, x, y, detached: false };
  }
  throw new HttpError(400, "Anchor type must be 'node' or 'canvas'");
}

// ------------------------------------------------------------------ presenting

export async function presentThreads(threads, workspaceId) {
  if (!threads.length) return [];
  const comments = await Comment.find({ threadId: { $in: threads.map((t) => t._id) } }).sort({ createdAt: 1, _id: 1 }).lean();
  const userIds = new Set();
  for (const t of threads) {
    userIds.add(String(t.createdBy));
    if (t.resolvedBy) userIds.add(String(t.resolvedBy));
  }
  for (const c of comments) {
    userIds.add(String(c.authorId));
    for (const m of c.mentions || []) userIds.add(String(m));
  }
  const [users, members] = await Promise.all([
    User.find({ _id: { $in: [...userIds] } }).select('name email').lean(),
    Membership.find({ workspaceId, userId: { $in: [...userIds] } }).select('userId').lean(),
  ]);
  const people = directory(users, members);
  const byThread = new Map(threads.map((t) => [String(t._id), []]));
  for (const c of comments) byThread.get(String(c.threadId))?.push(presentComment(c, people));
  return threads.map((t) => presentThread(t, byThread.get(String(t._id)) || [], people));
}

export async function presentOne(thread, workspaceId) {
  return (await presentThreads([thread], workspaceId))[0];
}

export async function presentCommentWithPeople(comment, workspaceId) {
  const ids = [String(comment.authorId), ...(comment.mentions || []).map(String)];
  const [users, members] = await Promise.all([
    User.find({ _id: { $in: ids } }).select('name email').lean(),
    Membership.find({ workspaceId, userId: { $in: ids } }).select('userId').lean(),
  ]);
  return presentComment(comment, directory(users, members));
}

/** id -> { id, name, left } - "(left)" marks authors who've since left the workspace. */
function directory(users, members) {
  const memberIds = new Set(members.map((m) => String(m.userId)));
  return new Map(users.map((u) => [String(u._id), { id: String(u._id), name: u.name || u.email, left: !memberIds.has(String(u._id)) }]));
}

function person(people, id) {
  if (!id) return null;
  return people.get(String(id)) || { id: String(id), name: 'Unknown user', left: true };
}

function presentComment(c, people) {
  const deleted = Boolean(c.deletedAt);
  return {
    id: String(c._id),
    threadId: String(c.threadId),
    author: person(people, c.authorId),
    body: deleted ? '' : c.body,
    mentions: deleted ? [] : (c.mentions || []).map((m) => person(people, m)),
    editedAt: c.editedAt,
    deletedAt: c.deletedAt,
    deleted,
    createdAt: c.createdAt,
  };
}

function presentThread(t, comments, people) {
  return {
    id: String(t._id),
    workflowId: String(t.workflowId),
    anchor: t.anchor,
    resolvedAt: t.resolvedAt,
    resolvedBy: person(people, t.resolvedBy),
    createdBy: person(people, t.createdBy),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    comments,
    replyCount: Math.max(0, comments.length - 1),
  };
}

// ------------------------------------------------------------------ notifying

async function threadLink(thread) {
  const ws = await Workspace.findById(thread.workspaceId).select('slug').lean();
  return ws ? `/w/${ws.slug}/workflows/${thread.workflowId}?thread=${thread._id}` : '';
}

/**
 * After a comment is written: mentions get a `mention`, earlier participants
 * get a `comment_reply` (unless they're mentioned too - one notification per
 * person per comment is enough), and the author starts watching the workflow.
 */
export async function afterCommentWritten({ workflow, thread, comment, actor, isReply, newMentions = comment.mentions }) {
  const link = await threadLink(thread);
  const text = await preview(comment.body);
  const actorName = actor?.name || actor?.email || 'Someone';
  const mentioned = (newMentions || []).map(String);

  await notify(mentioned, {
    workspaceId: thread.workspaceId,
    kind: 'mention',
    title: `${actorName} mentioned you on ${workflow.name}`,
    body: text,
    link,
    actorId: comment.authorId,
  });

  if (isReply) {
    const earlier = await Comment.find({ threadId: thread._id, _id: { $ne: comment._id } }).select('authorId').lean();
    const participants = new Set([String(thread.createdBy), ...earlier.map((c) => String(c.authorId))]);
    for (const id of mentioned) participants.delete(id);
    await notify([...participants], {
      workspaceId: thread.workspaceId,
      kind: 'comment_reply',
      title: `${actorName} replied on ${workflow.name}`,
      body: text,
      link,
      actorId: comment.authorId,
    });
  }

  await autoWatch(workflow, comment.authorId);
}

// ------------------------------------------------------------------ anchors vs. the graph

/**
 * Comments must not vanish because someone tidied the graph (spec/29 §1). The
 * hub reports deletions - from a collaboration op or a whole-document save -
 * and re-additions of the same node id (undo), and threads follow.
 */
async function setDetached(workflowId, nodeId, detached, node) {
  const threads = await CommentThread.find({
    workflowId, 'anchor.type': 'node', 'anchor.nodeId': nodeId, 'anchor.detached': !detached,
  });
  for (const thread of threads) {
    thread.anchor.detached = detached;
    if (detached && node?.position) {
      thread.anchor.x = node.position.x;
      thread.anchor.y = node.position.y;
    }
    await thread.save();
    emitToWorkflow(workflowId, 'comment:anchor', { threadId: String(thread._id), anchor: thread.anchor });
  }
}

let hooked = false;
export function registerHubHooks() {
  if (hooked) return;
  hooked = true;
  hub.onNodeDeleted((workflowId, nodeId, lastKnownNode) => setDetached(workflowId, nodeId, true, lastKnownNode));
  hub.onNodeRestored((workflowId, nodeId) => setDetached(workflowId, nodeId, false));
}
registerHubHooks();
