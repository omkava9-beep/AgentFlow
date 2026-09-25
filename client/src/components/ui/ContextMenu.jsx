import { forwardRef } from 'react';
import * as RCM from '@radix-ui/react-context-menu';
import { Check, ChevronRight } from 'lucide-react';
import { cx } from './cx';
import {
  menuContentClass, menuItemClass, menuDestructiveClass, menuSeparatorClass, menuLabelClass, menuShortcutClass,
} from './menuStyles';

/**
 * Right-click menus (Radix Context Menu), styled with the design tokens.
 *
 *   <ContextMenu>
 *     <ContextMenuTrigger asChild><div>…</div></ContextMenuTrigger>
 *     <ContextMenuContent>
 *       <ContextMenuItem icon={Copy} shortcut="⌘D" onSelect={…}>Duplicate</ContextMenuItem>
 *       <ContextMenuSeparator />
 *       <ContextMenuItem icon={Trash2} destructive onSelect={…}>Delete</ContextMenuItem>
 *     </ContextMenuContent>
 *   </ContextMenu>
 */
export const ContextMenu = RCM.Root;
export const ContextMenuTrigger = RCM.Trigger;
export const ContextMenuGroup = RCM.Group;
export const ContextMenuSub = RCM.Sub;
export const ContextMenuRadioGroup = RCM.RadioGroup;

export const ContextMenuContent = forwardRef(function ContextMenuContent({ className = '', ...props }, ref) {
  return (
    <RCM.Portal>
      <RCM.Content ref={ref} collisionPadding={8} className={cx(menuContentClass, className)} {...props} />
    </RCM.Portal>
  );
});

export const ContextMenuItem = forwardRef(function ContextMenuItem(
  { icon: Icon, shortcut, destructive = false, className = '', children, ...props },
  ref,
) {
  return (
    <RCM.Item ref={ref} className={cx(menuItemClass, destructive && menuDestructiveClass, className)} {...props}>
      {Icon && <Icon aria-hidden="true" />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut && <span className={menuShortcutClass}>{shortcut}</span>}
    </RCM.Item>
  );
});

export const ContextMenuCheckboxItem = forwardRef(function ContextMenuCheckboxItem(
  { shortcut, className = '', children, ...props },
  ref,
) {
  return (
    <RCM.CheckboxItem ref={ref} className={cx(menuItemClass, 'pl-8', className)} {...props}>
      <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
        <RCM.ItemIndicator><Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" /></RCM.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut && <span className={menuShortcutClass}>{shortcut}</span>}
    </RCM.CheckboxItem>
  );
});

export const ContextMenuRadioItem = forwardRef(function ContextMenuRadioItem({ className = '', children, ...props }, ref) {
  return (
    <RCM.RadioItem ref={ref} className={cx(menuItemClass, 'pl-8', className)} {...props}>
      <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
        <RCM.ItemIndicator><span className="h-1.5 w-1.5 rounded-full bg-accent" /></RCM.ItemIndicator>
      </span>
      {children}
    </RCM.RadioItem>
  );
});

export function ContextMenuSeparator({ className = '' }) {
  return <RCM.Separator className={cx(menuSeparatorClass, className)} />;
}

export function ContextMenuLabel({ className = '', children }) {
  return <RCM.Label className={cx(menuLabelClass, className)}>{children}</RCM.Label>;
}

export const ContextMenuSubTrigger = forwardRef(function ContextMenuSubTrigger({ icon: Icon, className = '', children, ...props }, ref) {
  return (
    <RCM.SubTrigger ref={ref} className={cx(menuItemClass, 'data-[state=open]:bg-bg-subtle', className)} {...props}>
      {Icon && <Icon aria-hidden="true" />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <ChevronRight className="ml-auto h-3.5 w-3.5 text-subtle" aria-hidden="true" />
    </RCM.SubTrigger>
  );
});

export const ContextMenuSubContent = forwardRef(function ContextMenuSubContent({ className = '', ...props }, ref) {
  return (
    <RCM.Portal>
      <RCM.SubContent ref={ref} collisionPadding={8} className={cx(menuContentClass, className)} {...props} />
    </RCM.Portal>
  );
});
