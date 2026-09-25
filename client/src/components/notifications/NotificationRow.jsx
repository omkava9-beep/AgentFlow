import { formatRelativeTime } from '../../utils/time';
import { kindMeta, collapsedNote } from './notificationKinds';
import { cx } from '../ui/cx';

const TONE = {
  accent: 'bg-accent-subtle text-accent-subtle-fg',
  info: 'bg-info-subtle text-info-subtle-fg',
  danger: 'bg-danger-subtle text-danger-subtle-fg',
  warning: 'bg-warning-subtle text-warning-subtle-fg',
  success: 'bg-success-subtle text-success-subtle-fg',
  neutral: 'bg-bg-subtle text-muted',
};

/** One notification: workspace, kind icon, title, time. Unread rows are bold. */
export default function NotificationRow({ n, onOpen, compact = false }) {
  const meta = kindMeta(n.kind);
  const Icon = meta.icon;
  const unread = !n.readAt;
  const note = collapsedNote(n);
  return (
    <button
      type="button"
      onClick={() => onOpen(n)}
      className={cx('flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-bg-subtle', unread && 'bg-accent-subtle/40')}
    >
      <span className={cx('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full', TONE[meta.tone] || TONE.neutral)} title={meta.label}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-2xs text-subtle">
          <span className="truncate font-medium">{n.workspace?.name || (n.kind === 'invite' ? 'Invitation' : 'Workspace')}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{formatRelativeTime(n.lastAt || n.createdAt)}</span>
        </span>
        <span className={cx('block text-sm', unread ? 'font-semibold text-fg' : 'text-muted')}>{n.title}</span>
        {(n.body || note) && (
          <span className={cx('block text-xs text-subtle', compact && 'truncate')}>
            {note ? `${note}${n.body ? ` · ${n.body}` : ''}` : n.body}
          </span>
        )}
      </span>
      {unread && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="unread" />}
    </button>
  );
}
