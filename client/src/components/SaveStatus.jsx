import { useWorkflowStore } from '../store/workflowStore';

/**
 * The sync pill that replaces the Save button (spec/28 §9). Every edit syncs
 * as it happens; this only says whether the server has confirmed it yet.
 */
export default function SaveStatus() {
  const connection = useWorkflowStore((s) => s.connection);
  const pending = useWorkflowStore((s) => s.pendingCount);
  const restError = useWorkflowStore((s) => s.restError);

  const plural = (n) => `${n} change${n === 1 ? '' : 's'}`;
  let text;
  let tone;
  if (restError) {
    text = restError;
    tone = 'error';
  } else if (connection === 'offline') {
    text = pending ? `Offline — ${plural(pending)} will sync when you reconnect` : 'Offline';
    tone = 'warn';
  } else if (connection === 'reconnecting') {
    text = pending ? `Reconnecting… · ${plural(pending)} pending` : 'Reconnecting…';
    tone = 'warn';
  } else if (pending) {
    text = 'Saving…';
    tone = 'busy';
  } else {
    text = 'All changes saved';
    tone = 'ok';
  }

  const styles = {
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300',
    busy: 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
    warn: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300',
    error: 'border-red-200 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300',
  };
  const dot = { ok: 'bg-emerald-500', busy: 'animate-pulse bg-brand-500', warn: 'bg-amber-500', error: 'bg-red-500' };

  return (
    <span
      data-testid="save-status"
      role="status"
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium shadow-sm ${styles[tone]}`}
    >
      <span className={`h-2 w-2 rounded-full ${dot[tone]}`} />
      {text}
    </span>
  );
}
