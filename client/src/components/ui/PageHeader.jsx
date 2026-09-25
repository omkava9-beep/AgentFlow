import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cx } from './cx';

/**
 * Every list/detail page starts with this: optional breadcrumbs, a title with
 * an optional icon and meta badges, a description, primary actions on the
 * right, and an optional tabs row underneath.
 */
export default function PageHeader({ title, description, icon: Icon, breadcrumbs, meta, actions, tabs, className = '' }) {
  return (
    <header className={cx('mb-6', className)}>
      {breadcrumbs?.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-xs text-subtle">
          {breadcrumbs.map((b, i) => (
            <span key={`${b.label}-${i}`} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3" aria-hidden="true" />}
              {b.to ? <Link to={b.to} className="hover:text-fg">{b.label}</Link> : <span className="text-muted">{b.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-default bg-surface text-muted shadow-sm">
              <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight text-fg">{title}</h1>
              {meta}
            </div>
            {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs && <div className="mt-4">{tabs}</div>}
    </header>
  );
}
