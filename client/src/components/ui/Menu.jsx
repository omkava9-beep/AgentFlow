import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';

/**
 * A small dropdown: a trigger button plus a popover of items. Closes on an
 * outside click, Escape, or picking an item. Used by the header's nav groups,
 * the user menu and the Builder's "⋯" overflow menu (spec/36).
 */
export function Menu({ label, title, align = 'left', buttonClassName = '', panelClassName = 'w-56', children, testId }) {
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
          className={`absolute top-full z-40 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900 ${
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

const itemClass = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800';

export function MenuLink({ to, children, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      role="menuitem"
      data-menu-close
      className={({ isActive }) => `${itemClass} ${isActive ? 'font-semibold text-brand-600 dark:text-brand-400' : ''}`}
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
      className={`${itemClass} ${danger ? 'text-red-600 dark:text-red-400' : ''}`}
    >
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="my-1 border-t border-slate-100 dark:border-slate-800" />;
}

export function MenuHeading({ children }) {
  return <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{children}</p>;
}
