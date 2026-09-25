import { formatPercent } from '../../utils/format';

/**
 * Run outcomes as one labelled meter per status, not a stacked bar.
 *
 * That's a deliberate choice: the status palette's good and critical steps are
 * only deltaE 4.1 apart under deuteranopia, so green and red segments sitting
 * flush against each other would be indistinguishable for a red-green colourblind
 * reader. Giving each status its own row with an icon, a word and a count means
 * identity never depends on hue — the colour is reinforcement, not the message.
 */
const STATUSES = [
  { key: 'success', label: 'Succeeded', icon: '✓', color: 'var(--viz-good)' },
  { key: 'failed', label: 'Failed', icon: '✕', color: 'var(--viz-critical)' },
  { key: 'cancelled', label: 'Cancelled', icon: '⊘', color: 'var(--viz-warning)' },
  { key: 'active', label: 'In flight', icon: '◔', color: 'var(--viz-neutral)' },
];

export default function OutcomeMeters({ breakdown, total }) {
  if (!total) return <p className="py-6 text-center text-xs text-subtle">No runs in this range.</p>;

  return (
    <ul className="space-y-3">
      {STATUSES.map((status) => {
        const count = breakdown?.[status.key] || 0;
        const share = count / total;
        return (
          <li key={status.key}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 text-muted">
                <span aria-hidden="true" style={{ color: status.color }}>{status.icon}</span>
                {status.label}
              </span>
              <span className="tabular-nums text-muted">
                {count} <span className="text-subtle">· {formatPercent(share)}</span>
              </span>
            </div>
            <span className="mt-1 block h-2 w-full overflow-hidden rounded-sm bg-bg-subtle">
              <span
                className="block h-full rounded-r-[4px]"
                style={{
                  width: `${share * 100}%`,
                  background: status.color,
                  // The warning step is sub-3:1 on white by design; a hairline
                  // ring keeps a thin fill visible without altering the hue.
                  boxShadow: 'inset 0 0 0 1px var(--viz-ring)',
                }}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
