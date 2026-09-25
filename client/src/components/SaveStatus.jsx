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

  // Quiet when everything's saved (text only); coloured only when it needs attention.
  const styles = {
    ok: 'border-transparent text-subtle',
    busy: 'border-transparent text-subtle',
    warn: 'border-warning/30 bg-warning-subtle text-warning-subtle-fg',
    error: 'border-danger/30 bg-danger-subtle text-danger-subtle-fg',
  };
  const dot = { ok: 'bg-success', busy: 'animate-pulse bg-accent', warn: 'bg-warning', error: 'bg-danger' };

  return (
    <span
      data-testid="save-status"
      role="status"
      title={text}
      className={`inline-flex h-7 min-w-0 max-w-[16rem] items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-xs font-medium ${styles[tone]}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot[tone]}`} aria-hidden="true" />
      <span className="truncate">{text}</span>
    </span>
  );
}
