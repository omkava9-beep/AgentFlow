import * as RSA from '@radix-ui/react-scroll-area';
import { cx } from './cx';

/** Themed, overlay scrollbars (Radix ScrollArea). Give it a bounded height via `className`. */
export default function ScrollArea({ className = '', viewportClassName = '', children, orientation = 'vertical' }) {
  return (
    <RSA.Root type="hover" className={cx('relative overflow-hidden', className)}>
      <RSA.Viewport className={cx('h-full w-full rounded-[inherit]', viewportClassName)}>{children}</RSA.Viewport>
      {(orientation === 'vertical' || orientation === 'both') && (
        <RSA.Scrollbar orientation="vertical" className="flex w-2 touch-none select-none p-0.5">
          <RSA.Thumb className="relative flex-1 rounded-full bg-[rgb(var(--border-strong))]" />
        </RSA.Scrollbar>
      )}
      {(orientation === 'horizontal' || orientation === 'both') && (
        <RSA.Scrollbar orientation="horizontal" className="flex h-2 touch-none select-none flex-col p-0.5">
          <RSA.Thumb className="relative flex-1 rounded-full bg-[rgb(var(--border-strong))]" />
        </RSA.Scrollbar>
      )}
    </RSA.Root>
  );
}
