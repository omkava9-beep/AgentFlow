import { Inbox } from 'lucide-react';

/**
 * The zero-items state for any list (spec/36 §6): what this page is for, and the
 * one action that would put something in it. `icon` is a lucide component; a
 * legacy string icon still renders, but new code passes a component.
 */
export default function EmptyState({ icon: Icon = Inbox, title, body, action = null, secondaryAction = null, compact = false }) {
  return (
    <div
      data-testid="empty-state"
      className={`flex flex-col items-center rounded-card border border-dashed border-strong bg-surface text-center ${compact ? 'px-4 py-6' : 'px-6 py-14'}`}
    >
      <span className={`mb-3 flex items-center justify-center rounded-lg border border-default bg-bg-subtle text-subtle ${compact ? 'h-8 w-8' : 'h-10 w-10'}`} aria-hidden="true">
        {typeof Icon === 'string' ? <span className="text-base">{Icon}</span> : <Icon className={compact ? 'h-4 w-4' : 'h-5 w-5'} />}
      </span>
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {(action || secondaryAction) && <div className="mt-4 flex items-center gap-2">{action}{secondaryAction}</div>}
    </div>
  );
}
