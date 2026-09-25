import { useEffect, useState } from 'react';
import { UserCheck, Timer, Users } from 'lucide-react';
import ApprovalDecision from './ApprovalDecision';
import { decideApproval } from '../api/approvals';
import { useAuthStore } from '../store/authStore';
import { useCan } from '../hooks/useCan';
import { formatDuration } from '../utils/relativeTime';
import { Badge, AvatarStack } from './ui';

/**
 * The run monitor's "Waiting for approval" banner (spec/32 UI). Eligible
 * people - assignees, or anyone with runs:approve_any - get the buttons. A
 * parked delay shows when it resumes instead.
 */
export default function ApprovalBanner({ run }) {
  const me = useAuthStore((s) => s.user?.id);
  const canOverride = useCan('runs:approve_any');
  const canApprove = useCan('runs:approve');
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const waiting = (run?.nodeResults || []).filter((r) => r.status === 'waiting');
  if (!waiting.length) return null;

  return (
    <div className="flex flex-col gap-2 border-b border-warning/30 bg-warning-subtle/60 px-4 py-3">
      {waiting.map((r) => {
        const a = r.approval;
        if (!a) {
          return (
            <p key={r.nodeId} className="flex items-center gap-2 text-sm text-warning-subtle-fg">
              <Timer className="h-4 w-4" aria-hidden="true" />
              <span className="font-medium">Parked delay</span> · resumes {r.resumeAt ? new Date(r.resumeAt).toLocaleString() : 'soon'}
            </p>
          );
        }
        const ids = (a.assigneeIds || []).map(String);
        const people = ids.map((id) => ({ id, name: a.assigneeNames?.[id] || 'Member' }));
        const approved = new Set((a.approvals || []).filter((x) => x.decision === 'approved').map((x) => x.userId)).size;
        const eligible = canApprove && (ids.includes(String(me)) || canOverride);
        const alreadyMine = (a.approvals || []).some((x) => x.userId === String(me));
        const timeLeft = r.resumeAt ? new Date(r.resumeAt).getTime() - Date.now() : null;
        return (
          <div key={r.nodeId} className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning-subtle-fg">
                <UserCheck className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sm text-fg">
                  <span className="font-semibold">Waiting for approval</span>
                  <span className="text-muted"> · {a.title}</span>
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  {people.length ? (
                    <span className="inline-flex items-center gap-1.5"><AvatarStack people={people} size="xs" max={4} />{people.map((p) => p.name).join(', ')}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-danger"><Users className="h-3 w-3" aria-hidden="true" />No eligible assignees left</span>
                  )}
                  <Badge tone="warning" size="xs">{approved} of {a.minApprovals || 1} approvals</Badge>
                  {timeLeft !== null && (
                    <span className="inline-flex items-center gap-1"><Timer className="h-3 w-3" aria-hidden="true" />auto-{a.timeoutOutcome === 'approved' ? 'approves' : 'rejects'} in {formatDuration(timeLeft)}</span>
                  )}
                </div>
                {a.description && <p className="mt-1 text-xs text-muted">{a.description}</p>}
              </div>
            </div>
            {eligible && !alreadyMine && (
              <ApprovalDecision compact onDecide={(decision, comment) => decideApproval(run._id, r.nodeId, decision, comment)} />
            )}
            {alreadyMine && <Badge tone="success" size="xs">You approved — waiting for others</Badge>}
          </div>
        );
      })}
    </div>
  );
}
