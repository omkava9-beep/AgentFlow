import { cx } from './cx';

/** A horizontal bar of controls (page/filter toolbars, canvas toolbar). */
export function Toolbar({ className = '', children }) {
  return <div className={cx('flex min-w-0 items-center gap-2', className)} role="toolbar">{children}</div>;
}

/** Joins adjacent buttons into one bordered group. */
export function ToolbarGroup({ className = '', children }) {
  return (
    <div className={cx('flex items-center rounded-control border border-default bg-surface p-0.5 shadow-sm [&_button]:shadow-none', className)}>
      {children}
    </div>
  );
}

export function ToolbarDivider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-[rgb(var(--border))]" aria-hidden="true" />;
}
