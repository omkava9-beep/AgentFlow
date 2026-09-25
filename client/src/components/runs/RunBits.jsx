import { RotateCcw, Repeat2, GitBranch, Bot, Clock, Webhook, Zap, KeyRound, Workflow as WorkflowIcon } from 'lucide-react';
import { Avatar, Tooltip } from '../ui';
import { formatRelativeTime } from '../../utils/time';
import { formatDuration } from '../../utils/format';

/** "3m ago", with the exact timestamp on hover. */
export function RelativeTime({ value, className = '' }) {
  if (!value) return <span className="text-subtle">—</span>;
  const d = new Date(value);
  return (
    <Tooltip content={d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' })}>
      <time dateTime={d.toISOString()} className={`whitespace-nowrap tabular-nums ${className}`}>{formatRelativeTime(d)}</time>
    </Tooltip>
  );
}

/** Wall-clock duration; a still-running run shows elapsed time. */
export function Duration({ ms, running = false, startedAt }) {
  if (ms == null && running && startedAt) {
    return <span className="tabular-nums text-info">{formatDuration(Date.now() - new Date(startedAt).getTime())}…</span>;
  }
  return <span className="tabular-nums">{ms == null ? '—' : formatDuration(ms)}</span>;
}

/** "9 / 11 nodes", failed count in red, and the worst retry count. */
export function NodeProgress({ counts, maxAttempts }) {
  if (!counts?.total) return <span className="text-subtle">—</span>;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap tabular-nums">
      <span className="text-muted">
        <span className="text-fg">{counts.succeeded}</span>/{counts.total}
      </span>
      {counts.failed > 0 && <span className="text-danger">{counts.failed} failed</span>}
      {maxAttempts > 1 && (
        <Tooltip content={`A node needed ${maxAttempts} attempts`}>
          <span className="inline-flex items-center gap-0.5 text-warning"><RotateCcw className="h-3 w-3" aria-hidden="true" />{maxAttempts}</span>
        </Tooltip>
      )}
    </span>
  );
}

/** Re-run / retry / parent markers after the run id. */
export function LineageIcons({ run }) {
  return (
    <span className="inline-flex items-center gap-1 text-subtle">
      {run.rerunOf && <Tooltip content="Re-run of an earlier run"><Repeat2 className="h-3.5 w-3.5" aria-label="Re-run" /></Tooltip>}
      {run.retryOf && <Tooltip content="Retried from the failed nodes of an earlier run"><RotateCcw className="h-3.5 w-3.5" aria-label="Retry" /></Tooltip>}
      {run.childCount > 0 && (
        <Tooltip content={`${run.childCount} child run${run.childCount === 1 ? '' : 's'} (loop / sub-workflow)`}>
          <span className="inline-flex items-center gap-0.5 text-2xs"><GitBranch className="h-3.5 w-3.5" aria-hidden="true" />{run.childCount}</span>
        </Tooltip>
      )}
    </span>
  );
}

const AUTOMATED = {
  schedule: { icon: Clock, label: 'Schedule' },
  webhook: { icon: Webhook, label: 'Webhook' },
  event: { icon: Zap, label: 'Event' },
  api: { icon: KeyRound, label: 'API key' },
  subworkflow: { icon: WorkflowIcon, label: 'Parent run' },
};

/** Who started it: a person's avatar, or the automation that did. */
export function TriggeredBy({ run }) {
  if (run.triggeredBy) {
    const name = run.triggeredBy.name || run.triggeredBy.email || 'Member';
    return (
      <Tooltip content={`Started by ${name}`}>
        <span className="inline-flex"><Avatar name={name} email={run.triggeredBy.email} seed={run.triggeredBy.id} size="xs" /></span>
      </Tooltip>
    );
  }
  const a = AUTOMATED[run.trigger];
  const Icon = a?.icon || Bot;
  return (
    <Tooltip content={a ? `Started by ${a.label.toLowerCase()}` : 'Started automatically'}>
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-bg-subtle text-subtle"><Icon className="h-3 w-3" aria-hidden="true" /></span>
    </Tooltip>
  );
}

