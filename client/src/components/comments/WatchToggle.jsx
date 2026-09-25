import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
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
      className={`inline-flex h-8 w-8 items-center justify-center rounded-control transition-colors ${
        watching ? 'bg-accent-subtle text-accent-subtle-fg' : 'text-muted hover:bg-bg-subtle hover:text-fg'
      }`}
    >
      {/* Icon-only to keep the toolbar on one row (spec/36); the label is still
          read out, and the tooltip explains it. */}
      {watching ? <Bell className="h-4 w-4" aria-hidden="true" /> : <BellOff className="h-4 w-4" aria-hidden="true" />}
      <span className="sr-only">{watching ? 'Watching' : 'Watch'}</span>
    </button>
  );
}
