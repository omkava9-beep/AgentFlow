/**
 * Makes the job queue's bounded concurrency visible. Without it, a parallel run
 * and a sequential one look identical in the UI - the pool saturating and
 * draining is the whole point of the in-process queue.
 *
 * The counts are this workspace's own share of the pool (spec/24), drawn as
 * `cap` slots - the plan's concurrency limit (spec/33) - not the whole pool.
 * `poolSaturated` is the one shared signal: it tells "you're at your plan
 * limit" apart from "the server is busy" without exposing anyone else's counts.
 */
export default function QueueIndicator({ stats }) {
  if (!stats) return null;
  const { active = 0, queued = 0, concurrency = 0, poolSaturated = false } = stats;
  const cap = stats.cap ?? concurrency;
  const slots = Array.from({ length: cap }, (_, i) => i < active);
  const atCap = active >= cap && queued > 0;

  return (
    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
      <span className="font-medium uppercase tracking-wide text-slate-400" title="This workspace's jobs in the shared worker pool">
        Queue
      </span>
      <span className="flex items-center gap-1">
        {slots.map((filled, i) => (
          <span
            key={i}
            title={filled ? 'slot busy (this workspace)' : 'slot free'}
            className={`h-2.5 w-2.5 rounded-sm ${
              filled ? 'bg-brand-500' : 'bg-slate-200 dark:bg-slate-700'
            }`}
          />
        ))}
      </span>
      <span>
        {active} running · {queued} queued · plan limit {cap}
      </span>
      {atCap && !poolSaturated && (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" title="Queued jobs are waiting for this workspace's plan limit">
          At plan limit
        </span>
      )}
      {poolSaturated && (
        <span className="rounded bg-slate-200 px-1.5 py-0.5 font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200" title="Every slot in the shared pool is busy">
          Server busy
        </span>
      )}
    </div>
  );
}
