import { forwardRef } from 'react';
import { NavLink } from 'react-router-dom';
import * as DM from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight } from 'lucide-react';
import { cx } from './cx';
import Tooltip from './Tooltip';
import {
  menuContentClass, menuItemClass, menuDestructiveClass, menuSeparatorClass, menuLabelClass, menuShortcutClass,
} from './menuStyles';

/**
 * Dropdown menu (Radix): a trigger plus a portalled, collision-aware menu with
 * full keyboard support. Used by the user menu and the Builder's "⋯" menu.
 * Items accept a leading lucide icon as their first child.
 *
 *   <Menu label={<Icon/>} title="More" align="right">
 *     <MenuButton onClick={…}><Share2 /> Share</MenuButton>
 *     <MenuLink to="/x"><History /> History</MenuLink>
 *     <MenuSeparator />
 *   </Menu>
 */
export function Menu({ label, title, align = 'left', up = false, buttonClassName = '', panelClassName = 'w-56', children, testId, 'aria-label': ariaLabel }) {
  return (
    <DM.Root modal={false}>
      <Tooltip content={title}>
        <DM.Trigger asChild>
          <button type="button" aria-label={ariaLabel || title} data-testid={testId} className={buttonClassName}>
            {label}
          </button>
        </DM.Trigger>
      </Tooltip>
      <DM.Portal>
        <DM.Content
          side={up ? 'top' : 'bottom'}
          align={align === 'right' ? 'end' : 'start'}
          sideOffset={6}
          collisionPadding={8}
          className={cx(menuContentClass, panelClassName)}
        >
          {children}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function MenuLink({ to, children, end }) {
  return (
    <DM.Item asChild>
      <NavLink to={to} end={end} className={({ isActive }) => cx(menuItemClass, isActive && 'bg-bg-subtle font-medium')}>
        {children}
      </NavLink>
    </DM.Item>
  );
}

export function MenuButton({ onClick, children, disabled, title, danger = false, shortcut }) {
  return (
    <DM.Item onSelect={() => onClick?.()} disabled={disabled} title={title} className={cx(menuItemClass, danger && menuDestructiveClass)}>
      {children}
      {shortcut && <span className={menuShortcutClass}>{shortcut}</span>}
    </DM.Item>
  );
}

export function MenuCheckbox({ checked, onCheckedChange, children }) {
  return (
    <DM.CheckboxItem checked={checked} onCheckedChange={onCheckedChange} className={cx(menuItemClass, 'pl-8')}>
      <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
        <DM.ItemIndicator><Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" /></DM.ItemIndicator>
      </span>
      {children}
    </DM.CheckboxItem>
  );
}

export function MenuSeparator() {
  return <DM.Separator className={menuSeparatorClass} />;
}

export function MenuHeading({ children }) {
  return <DM.Label className={menuLabelClass}>{children}</DM.Label>;
}

export const MenuSub = DM.Sub;
export const MenuSubTrigger = forwardRef(function MenuSubTrigger({ children, className = '', ...props }, ref) {
  return (
    <DM.SubTrigger ref={ref} className={cx(menuItemClass, 'data-[state=open]:bg-bg-subtle', className)} {...props}>
      {children}
      <ChevronRight className="ml-auto h-3.5 w-3.5 text-subtle" aria-hidden="true" />
    </DM.SubTrigger>
  );
});
export const MenuSubContent = forwardRef(function MenuSubContent({ className = '', ...props }, ref) {
  return (
    <DM.Portal>
      <DM.SubContent ref={ref} collisionPadding={8} className={cx(menuContentClass, className)} {...props} />
    </DM.Portal>
  );
});
