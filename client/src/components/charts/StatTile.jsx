/**
 * A single headline number is a stat tile, not a one-bar chart. Values use
 * proportional figures; only aligned columns get tabular-nums.
 */
export default function StatTile({ label, value, hint }) {
  return (
    <div className="rounded-card border border-default bg-surface p-4">
      <p className="text-xs font-medium text-subtle">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-fg">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}
