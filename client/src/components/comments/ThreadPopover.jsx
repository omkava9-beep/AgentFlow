import { useState } from 'react';
import { formatRelativeTime } from '../../utils/time';
import { decodeMentions } from '../../utils/mentions';
import { useAuthStore } from '../../store/authStore';
import { useCan } from '../../hooks/useCan';
import { replyToThread, editComment, deleteComment, resolveThread, reopenThread } from '../../api/comments';
import CommentBody from './CommentBody';
import MentionComposer from './MentionComposer';

/** One thread: its comments, reply composer, resolve/reopen (spec/29 UI). */
export default function ThreadPopover({ thread, api, onClose, style }) {
  const userId = useAuthStore((s) => s.user?.id);
  const canModerate = useCan('comments:moderate');
  const canWrite = useCan('comments:write');
  const [editing, setEditing] = useState(null);
  const resolved = Boolean(thread.resolvedAt);

  async function toggleResolved() {
    const next = resolved ? await reopenThread(thread.id) : await resolveThread(thread.id);
    api.upsertThread(next);
  }

  return (
    <div
      style={style}
      data-testid="thread-popover"
      className="pointer-events-auto absolute z-30 w-80 rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {thread.anchor.detached ? 'Node deleted' : thread.anchor.type === 'node' ? `On ${thread.anchor.nodeId}` : 'On the canvas'}
          {resolved && ' · Resolved'}
        </span>
        <div className="flex items-center gap-1">
          {canWrite && (
            <button type="button" onClick={toggleResolved} data-testid="thread-resolve" className="rounded-md px-2 py-0.5 text-xs font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10">
              {resolved ? 'Reopen' : 'Resolve'}
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md px-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
        </div>
      </div>
      <div className="max-h-72 space-y-3 overflow-y-auto px-3 py-2.5">
        {thread.comments.map((c) => {
          const mine = c.author?.id === userId;
          return (
            <div key={c.id} data-testid="thread-comment">
              <div className="mb-0.5 flex items-center gap-2 text-xs">
                <span className="font-semibold text-slate-800 dark:text-slate-100">
                  {c.author?.name}{c.author?.left && <span className="font-normal text-slate-400"> (left)</span>}
                </span>
                <span className="text-slate-400">{formatRelativeTime(c.createdAt)}{c.editedAt && ' · edited'}</span>
                {!c.deleted && (
                  <span className="ml-auto flex gap-1">
                    {mine && (
                      <button type="button" onClick={() => setEditing(c.id)} className="text-slate-400 hover:text-slate-600">Edit</button>
                    )}
                    {(mine || canModerate) && (
                      <button
                        type="button"
                        onClick={async () => {
                          await deleteComment(c.id);
                          api.removeComment(thread.id, c.id, thread.comments[0]?.id === c.id);
                          if (thread.comments[0]?.id === c.id) onClose();
                        }}
                        className="text-slate-400 hover:text-red-600"
                      >
                        Delete
                      </button>
                    )}
                  </span>
                )}
              </div>
              {editing === c.id ? (
                <MentionComposer
                  {...(() => { const d = decodeMentions(c.body, c.mentions); return { initialText: d.text, initialPicked: d.picked }; })()}
                  submitLabel="Save"
                  onCancel={() => setEditing(null)}
                  onSubmit={async (body) => {
                    api.replaceComment(thread.id, await editComment(c.id, body));
                    setEditing(null);
                  }}
                />
              ) : (
                <CommentBody comment={c} />
              )}
            </div>
          );
        })}
      </div>
      {canWrite && (
        <div className="border-t border-slate-100 px-3 py-2 dark:border-slate-800">
          <MentionComposer
            placeholder="Reply… (@ to mention)"
            submitLabel="Reply"
            autoFocus={false}
            onSubmit={async (body) => api.addComment(thread.id, await replyToThread(thread.id, body))}
          />
        </div>
      )}
    </div>
  );
}
