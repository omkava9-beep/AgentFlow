/**
 * Makes the job queue's bounded concurrency visible. Without it, a parallel run
 * and a sequential one look identical in the UI - the pool saturating and
 * draining is the whole point of the in-process queue.
 */
export default function QueueIndicator({ stats }) {
  if (!stats) return null;
  const { active, queued, concurrency } = stats;
  const slots = Array.from({ length: concurrency }, (_, i) => i < active);

  return (
    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
      <span className="font-medium uppercase tracking-wide text-slate-400">Queue</span>
      <span className="flex items-center gap-1">
        {slots.map((filled, i) => (
          <span
            key={i}
            title={filled ? 'slot busy' : 'slot free'}
            className={`h-2.5 w-2.5 rounded-sm ${
              filled ? 'bg-brand-500' : 'bg-slate-200 dark:bg-slate-700'
            }`}
          />
        ))}
      </span>
      <span>
        {active} running · {queued} queued · limit {concurrency}
      </span>
    </div>
  );
}
