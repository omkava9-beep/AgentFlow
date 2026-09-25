import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from './cx';
import { IconButton } from './Button';

/** Right-hand slide-over for secondary detail (version history, run detail, filters). */
export default function Drawer({ open, onClose, title, description, actions, width = 'w-[420px]', children, footer }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 animate-fade-in bg-zinc-950/40" onMouseDown={onClose} aria-hidden="true" />
      <aside role="dialog" aria-modal="true" aria-label={title} className={cx('relative flex h-full max-w-full animate-slide-in-right flex-col border-l border-default bg-surface shadow-popover', width)}>
        <div className="flex items-start justify-between gap-3 border-b border-default px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-fg">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <div className="flex items-center gap-1">
            {actions}
            <IconButton icon={X} label="Close" size="sm" onClick={onClose} tooltip={false} />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-default px-5 py-3">{footer}</div>}
      </aside>
    </div>,
    document.body,
  );
}
