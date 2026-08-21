/** Shared tooltip surface — Recharts' default chrome doesn't match the app. */
export default function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter }) {
  if (!active || !payload?.length) return null;
  const point = payload[0];

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800">
      <p className="font-medium text-slate-700 dark:text-slate-200">
        {labelFormatter ? labelFormatter(label, point) : label}
      </p>
      <p className="mt-0.5 flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
        <span className="h-2 w-2 rounded-sm" style={{ background: 'var(--viz-series)' }} />
        {valueFormatter ? valueFormatter(point.value, point) : point.value}
      </p>
    </div>
  );
}
