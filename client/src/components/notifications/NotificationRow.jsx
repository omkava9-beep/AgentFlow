import { formatRelativeTime } from '../../utils/time';
import { kindMeta, collapsedNote } from './notificationKinds';

/** One notification: workspace, kind icon, title, time. Unread rows are bold. */
export default function NotificationRow({ n, onOpen, compact = false }) {
  const meta = kindMeta(n.kind);
  const unread = !n.readAt;
  const note = collapsedNote(n);
  return (
    <button
      type="button"
      onClick={() => onOpen(n)}
      className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
        unread ? 'bg-brand-50/40 dark:bg-brand-500/5' : ''
      }`}
    >
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm dark:bg-slate-800" title={meta.label}>
        {meta.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-400">
          <span className="truncate">{n.workspace?.name || (n.kind === 'invite' ? 'Invitation' : 'Workspace')}</span>
          <span>·</span>
          <span className="shrink-0 normal-case tracking-normal">{formatRelativeTime(n.lastAt || n.createdAt)}</span>
        </span>
        <span className={`block text-sm ${unread ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-300'}`}>
          {n.title}
        </span>
        {(n.body || note) && (
          <span className={`block text-xs text-slate-500 dark:text-slate-400 ${compact ? 'truncate' : ''}`}>
            {note ? `${note}${n.body ? ` · ${n.body}` : ''}` : n.body}
          </span>
        )}
      </span>
      {unread && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-label="unread" />}
    </button>
  );
}
