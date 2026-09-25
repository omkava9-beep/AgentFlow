import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cx } from './cx';

/**
 * A KPI: label, big number, optional delta (positive = good unless
 * `invertDelta`), hint line and a sparkline/chart slot on the right.
 */
export default function StatTile({ label, value, hint, delta, invertDelta = false, icon: Icon, children, className = '', to }) {
  const good = delta == null ? null : invertDelta ? delta < 0 : delta > 0;
  const DeltaIcon = delta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <div className={cx('flex min-w-0 flex-col rounded-card border border-default bg-surface p-4', className)} data-to={to}>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-subtle">{label}</p>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-2xl font-semibold tabular-nums tracking-tight text-fg">{value}</p>
          <div className="mt-1 flex items-center gap-1.5 text-xs">
            {delta != null && delta !== 0 && (
              <span className={cx('inline-flex items-center font-medium tabular-nums', good ? 'text-success' : 'text-danger')}>
                <DeltaIcon className="h-3 w-3" aria-hidden="true" />
                {Math.abs(delta)}%
              </span>
            )}
            {hint && <span className="truncate text-subtle">{hint}</span>}
          </div>
        </div>
        {children && <div className="h-10 w-24 shrink-0">{children}</div>}
      </div>
    </div>
  );
}
