import { cx } from '../../components/ui/index';

/**
 * One settings block: a title + description column beside (or above) the
 * controls, and an optional footer row for the save action. Every settings tab
 * is a stack of these, so they line up the same way everywhere.
 */
export default function SettingsCard({ title, description, footer, danger = false, flush = false, children, className = '', bodyClassName = '' }) {
  return (
    <section
      className={cx(
        'overflow-hidden rounded-card border bg-surface',
        danger ? 'border-danger/35' : 'border-default',
        className,
      )}
    >
      {(title || description) && (
        <header className={cx('border-b px-5 py-4', danger ? 'border-danger/25 bg-danger-subtle/40' : 'border-default')}>
          <h2 className={cx('text-sm font-semibold', danger ? 'text-danger' : 'text-fg')}>{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </header>
      )}
      <div className={cx(flush ? '' : 'px-5 py-4', bodyClassName)}>{children}</div>
      {footer && (
        <footer className={cx('flex items-center justify-end gap-3 border-t px-5 py-3', danger ? 'border-danger/25 bg-danger-subtle/20' : 'border-default bg-bg-subtle/50')}>
          {footer}
        </footer>
      )}
    </section>
  );
}
