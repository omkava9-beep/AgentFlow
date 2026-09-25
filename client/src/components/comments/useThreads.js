import { useCallback, useEffect, useState } from 'react';
import { listThreads } from '../../api/comments';
import { on } from '../../realtime/socket';

/**
 * A workflow's comment threads, kept live over the `workflow:<id>` room the
 * Builder already joined for collaboration (spec/29 socket contract). Local
 * writes apply their response immediately; the echo from the room is deduped.
 */
export function useThreads(workflowId) {
  const [threads, setThreads] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(() => {
    if (!workflowId) return Promise.resolve();
    return listThreads(workflowId)
      .then((list) => setThreads(list))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [workflowId]);

  useEffect(() => {
    setThreads([]);
    setLoaded(false);
    reload();
  }, [reload]);

  const upsertThread = useCallback((thread) => {
    setThreads((prev) => (prev.some((t) => t.id === thread.id) ? prev.map((t) => (t.id === thread.id ? thread : t)) : [...prev, thread]));
  }, []);

  const addComment = useCallback((threadId, comment) => {
    setThreads((prev) => prev.map((t) => {
      if (t.id !== threadId || t.comments.some((c) => c.id === comment.id)) return t;
      const comments = [...t.comments, comment];
      return { ...t, comments, replyCount: comments.length - 1 };
    }));
  }, []);

  const replaceComment = useCallback((threadId, comment) => {
    setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, comments: t.comments.map((c) => (c.id === comment.id ? comment : c)) } : t)));
  }, []);

  const removeComment = useCallback((threadId, commentId, threadDeleted) => {
    setThreads((prev) => {
      if (threadDeleted) return prev.filter((t) => t.id !== threadId);
      return prev.map((t) => (t.id === threadId
        ? { ...t, comments: t.comments.map((c) => (c.id === commentId ? { ...c, deleted: true, body: '', mentions: [], deletedAt: new Date().toISOString() } : c)) }
        : t));
    });
  }, []);

  const patchThread = useCallback((threadId, patch) => {
    setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, ...patch } : t)));
  }, []);

  useEffect(() => {
    if (!workflowId) return undefined;
    const mine = (p) => p?.workflowId === workflowId;
    const offs = [
      on('comment:created', (p) => {
        if (!mine(p)) return;
        if (p.thread) upsertThread(p.thread);
        else addComment(p.threadId, p.comment);
      }),
      on('comment:updated', (p) => mine(p) && replaceComment(p.threadId, p.comment)),
      on('comment:deleted', (p) => mine(p) && removeComment(p.threadId, p.commentId, p.threadDeleted)),
      on('comment:resolved', (p) => mine(p) && patchThread(p.threadId, {
        resolvedAt: p.resolved ? new Date().toISOString() : null,
        resolvedBy: p.resolved ? p.by : null,
      })),
      on('comment:anchor', (p) => mine(p) && patchThread(p.threadId, { anchor: p.anchor })),
    ];
    return () => offs.forEach((off) => off());
  }, [workflowId, upsertThread, addComment, replaceComment, removeComment, patchThread]);

  return { threads, loaded, reload, upsertThread, addComment, replaceComment, removeComment, patchThread };
}
