// Shared class names for Radix menus (DropdownMenu, ContextMenu, Select), so
// every menu in the app looks and behaves the same.
export const menuContentClass =
  'z-[80] min-w-[200px] overflow-hidden rounded-card border border-default bg-surface-raised p-1 text-fg shadow-popover ' +
  'data-[state=open]:animate-pop-in';

export const menuItemClass =
  'relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors ' +
  'data-[highlighted]:bg-bg-subtle data-[disabled]:pointer-events-none data-[disabled]:opacity-45 ' +
  '[&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0 [&>svg]:text-subtle';

export const menuDestructiveClass = 'text-danger [&>svg]:!text-danger data-[highlighted]:bg-danger-subtle';
export const menuSeparatorClass = '-mx-1 my-1 h-px bg-[rgb(var(--border))]';
export const menuLabelClass = 'px-2 pb-1 pt-1.5 text-2xs font-medium uppercase tracking-wider text-subtle';
export const menuShortcutClass = 'ml-auto pl-4 font-mono text-2xs tracking-wide text-subtle';
