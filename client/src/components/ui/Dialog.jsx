import * as RD from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cx } from './cx';

/**
 * Modal dialog (Radix): focus trap, Escape/overlay dismissal, scroll lock and
 * `aria-*` wiring. Header/body/footer slots give every dialog the same frame.
 * `dismissable={false}` blocks Escape and overlay clicks (e.g. while saving).
 */
export default function Dialog({ open = true, onClose, title, description, icon: Icon, footer, size = 'md', dismissable = true, children, className = '', testId }) {
  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return (
    <RD.Root open={open} onOpenChange={(o) => { if (!o) onClose?.(); }}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-zinc-950/50 data-[state=open]:animate-fade-in" />
        <RD.Content
          data-testid={testId}
          onEscapeKeyDown={(e) => { if (!dismissable) e.preventDefault(); }}
          onPointerDownOutside={(e) => { if (!dismissable) e.preventDefault(); }}
          aria-describedby={description ? undefined : undefined}
          className={cx(
            'fixed left-1/2 top-[10vh] z-50 max-h-[80vh] w-[calc(100vw-2rem)] -translate-x-1/2 overflow-y-auto rounded-dialog border border-default bg-surface-raised shadow-popover outline-none data-[state=open]:animate-pop-in',
            width,
            className,
          )}
        >
          <div className="flex items-start justify-between gap-3 px-5 pb-1 pt-4">
            <div className="flex min-w-0 items-start gap-3">
              {Icon && (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-default bg-bg-subtle text-muted">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
              )}
              <div className="min-w-0">
                <RD.Title className={cx('text-base font-semibold text-fg', !title && 'sr-only')}>{title || 'Dialog'}</RD.Title>
                {description ? <RD.Description className="mt-0.5 text-sm text-muted">{description}</RD.Description> : <RD.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</RD.Description>}
              </div>
            </div>
            {onClose && dismissable && (
              <RD.Close className="rounded-control p-1 text-subtle transition-colors hover:bg-bg-subtle hover:text-fg" aria-label="Close">
                <X className="h-4 w-4" aria-hidden="true" />
              </RD.Close>
            )}
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer && <div className="sticky bottom-0 z-[1] flex items-center justify-end gap-2 border-t border-default bg-surface-raised px-5 py-3">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
