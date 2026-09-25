import Workflow from '../models/Workflow.js';
import CommentThread from '../models/CommentThread.js';
import Comment from '../models/Comment.js';
import User from '../models/User.js';
import { HttpError } from '../middleware/errorHandler.js';
import { findInWorkspace, scopedFilter } from '../tenancy/scoped.js';
import { can } from '../tenancy/permissions.js';
import {
  cleanBody, resolveMentions, validateAnchor, presentThreads, presentOne, presentCommentWithPeople,
  afterCommentWritten, emitToWorkflow,
} from '../services/commentService.js';
import { isWatching, setWatching } from '../services/watchService.js';

/** Comment threads, replies and watching (spec/29). All lookups are workspace-scoped. */

const actorOf = (req) => User.findById(req.userId).select('name email').lean();

async function threadWithWorkflow(req) {
  const thread = await findInWorkspace(CommentThread, req.params.threadId, req);
  const workflow = await findInWorkspace(Workflow, thread.workflowId, req);
  return { thread, workflow };
}

export async function listThreads(req, res, next) {
  try {
    const workflow = await findInWorkspace(Workflow, req.params.id, req);
    const extra = { workflowId: workflow._id };
    if (req.query.resolved === 'true') extra.resolvedAt = { $ne: null };
    if (req.query.resolved === 'false') extra.resolvedAt = null;
    const threads = await CommentThread.find(scopedFilter(req, extra)).sort({ createdAt: 1 }).lean();
    res.json(await presentThreads(threads, req.workspaceId));
  } catch (err) {
    next(err);
  }
}

export async function createThread(req, res, next) {
  try {
    const workflow = await findInWorkspace(Workflow, req.params.id, req);
    let anchor;
    try {
      anchor = validateAnchor(workflow, req.body?.anchor);
    } catch (err) {
      if (err.code === 'node_missing') return res.status(409).json({ error: err.publicMessage, code: err.code });
      throw err;
    }
    const { body, mentions } = await resolveMentions(req.workspaceId, cleanBody(req.body?.body));

    const thread = await CommentThread.create({ workspaceId: req.workspaceId, workflowId: workflow._id, anchor, createdBy: req.userId });
    const comment = await Comment.create({ workspaceId: req.workspaceId, threadId: thread._id, authorId: req.userId, body, mentions });

    const presented = await presentOne(thread.toObject(), req.workspaceId);
    emitToWorkflow(workflow._id, 'comment:created', { threadId: presented.id, comment: presented.comments[0], thread: presented });
    await afterCommentWritten({ workflow, thread, comment, actor: await actorOf(req), isReply: false });
    res.status(201).json(presented);
  } catch (err) {
    next(err);
  }
}

export async function reply(req, res, next) {
  try {
    const { thread, workflow } = await threadWithWorkflow(req);
    const { body, mentions } = await resolveMentions(req.workspaceId, cleanBody(req.body?.body));
    const comment = await Comment.create({ workspaceId: req.workspaceId, threadId: thread._id, authorId: req.userId, body, mentions });
    await CommentThread.updateOne({ _id: thread._id }, { $set: { updatedAt: new Date() } });

    const presented = await presentCommentWithPeople(comment.toObject(), req.workspaceId);
    emitToWorkflow(workflow._id, 'comment:created', { threadId: String(thread._id), comment: presented });
    await afterCommentWritten({ workflow, thread, comment, actor: await actorOf(req), isReply: true });
    res.status(201).json(presented);
  } catch (err) {
    next(err);
  }
}

export async function editComment(req, res, next) {
  try {
    const comment = await findInWorkspace(Comment, req.params.commentId, req);
    if (comment.deletedAt) throw new HttpError(404, 'Comment not found');
    // Editing is the author's alone; moderators can delete, not rewrite (spec/29 §2).
    if (String(comment.authorId) !== String(req.userId)) throw new HttpError(403, 'Only the author can edit a comment');
    const thread = await findInWorkspace(CommentThread, comment.threadId, req);
    const workflow = await findInWorkspace(Workflow, thread.workflowId, req);

    const before = new Set(comment.mentions.map(String));
    const { body, mentions } = await resolveMentions(req.workspaceId, cleanBody(req.body?.body));
    comment.body = body;
    comment.mentions = mentions;
    comment.editedAt = new Date();
    await comment.save();

    const presented = await presentCommentWithPeople(comment.toObject(), req.workspaceId);
    emitToWorkflow(workflow._id, 'comment:updated', { threadId: String(thread._id), comment: presented });
    // Only people newly mentioned by the edit hear about it.
    const newMentions = mentions.filter((id) => !before.has(String(id)));
    if (newMentions.length) {
      await afterCommentWritten({ workflow, thread, comment, actor: await actorOf(req), isReply: false, newMentions });
    }
    res.json(presented);
  } catch (err) {
    next(err);
  }
}

export async function deleteComment(req, res, next) {
  try {
    const comment = await findInWorkspace(Comment, req.params.commentId, req);
    const isAuthor = String(comment.authorId) === String(req.userId);
    if (!isAuthor && !can(req.role, 'comments:moderate')) throw new HttpError(403, "You don't have permission to do that");
    const thread = await findInWorkspace(CommentThread, comment.threadId, req);

    const first = await Comment.findOne(scopedFilter(req, { threadId: thread._id })).sort({ createdAt: 1, _id: 1 }).select('_id').lean();
    const threadDeleted = String(first?._id) === String(comment._id);
    if (threadDeleted) {
      // The opening comment is the thread; without it the replies have nothing to answer.
      await Comment.deleteMany(scopedFilter(req, { threadId: thread._id }));
      await CommentThread.deleteOne(scopedFilter(req, { _id: thread._id }));
    } else {
      comment.deletedAt = new Date();
      comment.body = '';
      comment.mentions = [];
      await comment.save();
    }
    emitToWorkflow(thread.workflowId, 'comment:deleted', { threadId: String(thread._id), commentId: String(comment._id), threadDeleted });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function setResolved(req, res, next, resolved) {
  try {
    const { thread } = await threadWithWorkflow(req);
    thread.resolvedAt = resolved ? new Date() : null;
    thread.resolvedBy = resolved ? req.userId : null;
    await thread.save();
    const presented = await presentOne(thread.toObject(), req.workspaceId);
    emitToWorkflow(thread.workflowId, 'comment:resolved', { threadId: presented.id, resolved, by: presented.resolvedBy || { id: String(req.userId) } });
    res.json(presented);
  } catch (err) {
    next(err);
  }
}

export const resolveThread = (req, res, next) => setResolved(req, res, next, true);
export const reopenThread = (req, res, next) => setResolved(req, res, next, false);

/** Re-pinning, typically a detached thread to a canvas spot (or back onto a node). */
export async function updateThread(req, res, next) {
  try {
    const { thread, workflow } = await threadWithWorkflow(req);
    let anchor;
    try {
      anchor = validateAnchor(workflow, req.body?.anchor);
    } catch (err) {
      if (err.code === 'node_missing') return res.status(409).json({ error: err.publicMessage, code: err.code });
      throw err;
    }
    thread.anchor = anchor;
    await thread.save();
    emitToWorkflow(workflow._id, 'comment:anchor', { threadId: String(thread._id), anchor: thread.anchor });
    res.json(await presentOne(thread.toObject(), req.workspaceId));
  } catch (err) {
    next(err);
  }
}

export async function getWatch(req, res, next) {
  try {
    const workflow = await findInWorkspace(Workflow, req.params.id, req);
    res.json({ watching: await isWatching(workflow, req.userId) });
  } catch (err) {
    next(err);
  }
}

export async function watch(req, res, next) {
  try {
    await setWatching(await findInWorkspace(Workflow, req.params.id, req), req.userId, true);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function unwatch(req, res, next) {
  try {
    await setWatching(await findInWorkspace(Workflow, req.params.id, req), req.userId, false);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
