import { cx } from './cx';
import { STATUS_META } from './statusMeta';

const TONES = {
  neutral: 'bg-bg-subtle text-muted ring-zinc-900/5 dark:ring-white/10',
  accent: 'bg-accent-subtle text-accent-subtle-fg ring-accent/20',
  success: 'bg-success-subtle text-success-subtle-fg ring-success/20',
  warning: 'bg-warning-subtle text-warning-subtle-fg ring-warning/25',
  danger: 'bg-danger-subtle text-danger-subtle-fg ring-danger/20',
  info: 'bg-info-subtle text-info-subtle-fg ring-info/20',
};
const DOTS = { neutral: 'bg-zinc-400', accent: 'bg-accent', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', info: 'bg-info' };

export function Badge({ tone = 'neutral', dot = false, icon: Icon, size = 'sm', className = '', children, ...props }) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-medium ring-1 ring-inset',
        size === 'xs' ? 'px-1.5 py-px text-2xs' : 'px-2 py-0.5 text-xs',
        TONES[tone] || TONES.neutral,
        className,
      )}
      {...props}
    >
      {dot && <span className={cx('h-1.5 w-1.5 rounded-full', DOTS[tone])} aria-hidden="true" />}
      {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function StatusBadge({ status, label, size = 'sm', className = '' }) {
  const meta = STATUS_META[status] || STATUS_META.pending;
  const Icon = meta.icon;
  return (
    <span
      data-status={status}
      className={cx(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-medium ring-1 ring-inset',
        size === 'xs' ? 'px-1.5 py-px text-2xs' : 'px-2 py-0.5 text-xs',
        TONES[meta.tone],
        className,
      )}
    >
      <Icon className={cx('h-3 w-3', meta.spin && 'animate-spin')} aria-hidden="true" />
      {label || meta.label}
    </span>
  );
}

/** Just the icon, coloured by status - for dense rows and canvas nodes. */
export function StatusIcon({ status, className = 'h-4 w-4' }) {
  const meta = STATUS_META[status] || STATUS_META.pending;
  const Icon = meta.icon;
  const color = { neutral: 'text-subtle', info: 'text-info', warning: 'text-warning', success: 'text-success', danger: 'text-danger', accent: 'text-accent' }[meta.tone];
  return <Icon className={cx(className, color, meta.spin && 'animate-spin')} aria-label={meta.label} />;
}
