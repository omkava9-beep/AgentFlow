import { forwardRef } from 'react';
import * as RP from '@radix-ui/react-popover';
import { cx } from './cx';

/** Radix Popover styled with the tokens. `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverAnchor`, `PopoverClose`. */
export const Popover = RP.Root;
export const PopoverTrigger = RP.Trigger;
export const PopoverAnchor = RP.Anchor;
export const PopoverClose = RP.Close;

export const PopoverContent = forwardRef(function PopoverContent(
  { className = '', align = 'start', side = 'bottom', sideOffset = 6, padded = true, children, ...props },
  ref,
) {
  return (
    <RP.Portal>
      <RP.Content
        ref={ref}
        align={align}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cx(
          'z-[80] rounded-card border border-default bg-surface-raised text-fg shadow-popover outline-none data-[state=open]:animate-pop-in',
          padded && 'p-3',
          className,
        )}
        {...props}
      >
        {children}
      </RP.Content>
    </RP.Portal>
  );
});
