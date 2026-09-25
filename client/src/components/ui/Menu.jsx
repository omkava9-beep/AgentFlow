import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';

/**
 * A small dropdown: a trigger button plus a popover of items. Closes on an
 * outside click, Escape, or picking an item. Used by the header's nav groups,
 * the user menu and the Builder's "⋯" overflow menu (spec/36).
 */
export function Menu({ label, title, align = 'left', up = false, buttonClassName = '', panelClassName = 'w-56', children, testId }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testId}
        className={buttonClassName}
      >
        {label}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute ${up ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} z-40 animate-pop-in overflow-hidden rounded-card border border-default bg-surface-raised p-1 shadow-popover ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${panelClassName}`}
          // Children are rendered with a `close` helper so links and buttons
          // shut the menu once they've done their job.
          onClick={(e) => { if (e.target.closest('[data-menu-close]')) close(); }}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}

const itemClass = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg transition-colors hover:bg-bg-subtle focus:bg-bg-subtle focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-subtle';

export function MenuLink({ to, children, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      role="menuitem"
      data-menu-close
      className={({ isActive }) => `${itemClass} ${isActive ? 'bg-bg-subtle font-medium' : ''}`}
    >
      {children}
    </NavLink>
  );
}

export function MenuButton({ onClick, children, disabled, title, danger = false }) {
  return (
    <button
      type="button"
      role="menuitem"
      data-menu-close
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${itemClass} ${danger ? '!text-danger [&>svg]:!text-danger' : ''}`}
    >
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="-mx-1 my-1 border-t border-default" />;
}

export function MenuHeading({ children }) {
  return <p className="px-2 pb-1 pt-2 text-2xs font-medium uppercase tracking-wider text-subtle">{children}</p>;
}
