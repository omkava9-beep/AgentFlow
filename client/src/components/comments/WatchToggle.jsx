import { useEffect, useState } from 'react';
import { getWatch, watchWorkflow, unwatchWorkflow } from '../../api/comments';

/** The Builder toolbar's watch toggle (spec/29 §5): failed runs notify watchers. */
export default function WatchToggle({ workflowId }) {
  const [watching, setWatching] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getWatch(workflowId).then((r) => !cancelled && setWatching(r.watching)).catch(() => {});
    return () => { cancelled = true; };
  }, [workflowId]);

  if (watching === null) return null;
  return (
    <button
      type="button"
      data-testid="watch-toggle"
      onClick={async () => {
        const next = !watching;
        setWatching(next);
        try {
          await (next ? watchWorkflow(workflowId) : unwatchWorkflow(workflowId));
        } catch {
          setWatching(!next);
        }
      }}
      title={watching ? 'You get a notification when a run of this workflow fails' : 'Get notified when a run fails'}
      aria-pressed={watching}
      className={`rounded-lg border px-2.5 py-1.5 text-sm font-medium shadow-sm transition ${
        watching
          ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
      }`}
    >
      {/* Icon-only to keep the toolbar on one row (spec/36); the label is still
          read out, and the tooltip explains it. */}
      <span aria-hidden="true">{watching ? '🔔' : '🔕'}</span>
      <span className="sr-only">{watching ? 'Watching' : 'Watch'}</span>
    </button>
  );
}
