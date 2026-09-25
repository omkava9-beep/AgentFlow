import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from './cx';
import { IconButton } from './Button';

/**
 * Base modal. Closes on Escape and backdrop click (unless `dismissable` is
 * false), traps initial focus, and renders header/body/footer slots so every
 * dialog in the app has the same frame.
 */
export default function Dialog({ open = true, onClose, title, description, icon: Icon, footer, size = 'md', dismissable = true, children, className = '', testId }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const t = setTimeout(() => panelRef.current?.querySelector('input, textarea, select, button:not([data-dialog-close])')?.focus(), 0);
    const onKey = (e) => { if (e.key === 'Escape' && dismissable) onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open, dismissable, onClose]);

  if (!open) return null;
  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center overflow-y-auto bg-zinc-950/50 p-4 pt-[10vh]"
      onMouseDown={(e) => { if (dismissable && e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        data-testid={testId}
        className={cx('w-full animate-pop-in rounded-dialog border border-default bg-surface-raised shadow-popover', width, className)}
      >
        {(title || onClose) && (
          <div className="flex items-start justify-between gap-3 px-5 pb-1 pt-4">
            <div className="flex min-w-0 items-start gap-3">
              {Icon && (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-default bg-bg-subtle text-muted">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
              )}
              <div className="min-w-0">
                {title && <h2 className="text-base font-semibold text-fg">{title}</h2>}
                {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
              </div>
            </div>
            {onClose && dismissable && <IconButton icon={X} label="Close" size="sm" onClick={onClose} data-dialog-close tooltip={false} />}
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-default px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
