import Tooltip from '../ui/Tooltip';
/**
 * Horizontal bars for magnitude comparison, in one hue — colour isn't carrying
 * identity here, the label is, so a categorical palette would be noise.
 *
 * Hand-rolled rather than Recharts: at this size a div-based bar gives exact
 * 4px rounded data-ends, guaranteed gaps, and direct labels that can't collide,
 * and it stays readable for long category names like "slack-message".
 */
export default function CategoryBars({ data, emptyMessage = 'No data yet.' }) {
  if (!data?.length) {
    return <p className="py-6 text-center text-xs text-subtle">{emptyMessage}</p>;
  }

  const max = Math.max(...data.map((d) => d.count));

  return (
    <ul className="space-y-2">
      {data.map((item) => (
        <li key={item.label} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-2">
          <Tooltip content={item.label}><span className="truncate text-xs text-muted">
            {item.label}
          </span></Tooltip>
          <span className="h-2.5 w-full overflow-hidden rounded-sm bg-bg-subtle">
            <span
              className="block h-full rounded-r-[4px]"
              style={{
                width: `${Math.max(2, (item.count / max) * 100)}%`,
                background: 'var(--viz-series)',
              }}
            />
          </span>
          <span className="text-right text-xs tabular-nums text-muted">{item.count}</span>
        </li>
      ))}
    </ul>
  );
}
