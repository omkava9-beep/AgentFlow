/** One chart panel: title names the series, so single-series charts need no legend. */
export default function ChartCard({ title, subtitle, action, children, className = '' }) {
  return (
    <section
      className={`rounded-card border border-default bg-surface p-4 ${className}`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
