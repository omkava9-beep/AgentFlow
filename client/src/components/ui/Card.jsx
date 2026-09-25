import { cx } from './cx';

/** Flat surface with a hairline border - the default container for content. */
export function Card({ as: Tag = 'div', className = '', padded = false, interactive = false, children, ...props }) {
  return (
    <Tag
      className={cx(
        'rounded-card border border-default bg-surface',
        padded && 'p-4',
        interactive && 'transition-colors hover:border-strong hover:bg-bg-subtle/40',
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({ title, description, actions, icon: Icon, className = '' }) {
  return (
    <div className={cx('flex items-start justify-between gap-3 border-b border-default px-4 py-3', className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />}
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-fg">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-subtle">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className = '', children }) {
  return <div className={cx('p-4', className)}>{children}</div>;
}

/** A titled block inside a page or panel (no border of its own). */
export function Section({ title, description, actions, className = '', children }) {
  return (
    <section className={cx('space-y-3', className)}>
      {(title || actions) && (
        <div className="flex items-end justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-subtle">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
