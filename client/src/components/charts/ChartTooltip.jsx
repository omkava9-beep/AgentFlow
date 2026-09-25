/** Shared tooltip surface — Recharts' default chrome doesn't match the app. */
export default function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter }) {
  if (!active || !payload?.length) return null;
  const point = payload[0];

  return (
    <div className="rounded-lg border border-default bg-surface-raised px-2.5 py-1.5 text-xs shadow-popover">
      <p className="font-medium text-fg">
        {labelFormatter ? labelFormatter(label, point) : label}
      </p>
      <p className="mt-0.5 flex items-center gap-1.5 text-muted">
        <span className="h-2 w-2 rounded-sm" style={{ background: 'var(--viz-series)' }} />
        {valueFormatter ? valueFormatter(point.value, point) : point.value}
      </p>
    </div>
  );
}
