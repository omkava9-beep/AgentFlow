import * as RD from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cx } from './cx';

/** Right-hand slide-over (Radix Dialog) for secondary detail: version history, run detail, filters. */
export default function Drawer({ open, onClose, title, description, actions, width = 'w-[420px]', children, footer }) {
  return (
    <RD.Root open={Boolean(open)} onOpenChange={(o) => { if (!o) onClose?.(); }}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-zinc-950/40 data-[state=open]:animate-fade-in" />
        <RD.Content className={cx('fixed inset-y-0 right-0 z-50 flex max-w-full flex-col border-l border-default bg-surface shadow-popover outline-none data-[state=open]:animate-slide-in-right', width)}>
          <div className="flex items-start justify-between gap-3 border-b border-default px-5 py-4">
            <div className="min-w-0">
              <RD.Title className="truncate text-base font-semibold text-fg">{title}</RD.Title>
              <RD.Description className={description ? 'mt-0.5 text-sm text-muted' : 'sr-only'}>{description || title}</RD.Description>
            </div>
            <div className="flex items-center gap-1">
              {actions}
              <RD.Close className="rounded-control p-1 text-subtle hover:bg-bg-subtle hover:text-fg" aria-label="Close"><X className="h-4 w-4" aria-hidden="true" /></RD.Close>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="border-t border-default px-5 py-3">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
