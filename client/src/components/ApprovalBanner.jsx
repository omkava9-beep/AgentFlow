import { useEffect, useState } from 'react';
import ApprovalDecision from './ApprovalDecision';
import { decideApproval } from '../api/approvals';
import { useAuthStore } from '../store/authStore';
import { useCan } from '../hooks/useCan';
import { formatDuration } from '../utils/relativeTime';

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
    <div className="flex flex-col gap-2 border-b border-orange-200 bg-orange-50 px-4 py-3 dark:border-orange-900 dark:bg-orange-950/40">
      {waiting.map((r) => {
        const a = r.approval;
        if (!a) {
          return (
            <p key={r.nodeId} className="text-sm text-orange-800 dark:text-orange-200">
              ⏱ Parked delay · resumes at {r.resumeAt ? new Date(r.resumeAt).toLocaleString() : 'soon'}
            </p>
          );
        }
        const ids = (a.assigneeIds || []).map(String);
        const names = ids.map((id) => a.assigneeNames?.[id] || 'member');
        const approved = new Set((a.approvals || []).filter((x) => x.decision === 'approved').map((x) => x.userId)).size;
        const eligible = canApprove && (ids.includes(String(me)) || canOverride);
        const alreadyMine = (a.approvals || []).some((x) => x.userId === String(me));
        const timeLeft = r.resumeAt ? new Date(r.resumeAt).getTime() - Date.now() : null;
        return (
          <div key={r.nodeId} className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-orange-900 dark:text-orange-100">
              <span className="font-semibold">✋ Waiting for approval</span>
              {' · '}{a.title}
              {' · '}assigned to {names.length ? names.join(', ') : <em>no eligible assignees left</em>}
              {' · '}{approved} of {a.minApprovals || 1} needed
              {timeLeft !== null && ` · auto-${a.timeoutOutcome === 'approved' ? 'approves' : 'rejects'} in ${formatDuration(timeLeft)}`}
              {a.description && <div className="text-xs text-orange-800/80 dark:text-orange-200/80">{a.description}</div>}
            </div>
            {eligible && !alreadyMine && (
              <ApprovalDecision compact onDecide={(decision, comment) => decideApproval(run._id, r.nodeId, decision, comment)} />
            )}
            {alreadyMine && <span className="text-xs text-orange-700 dark:text-orange-300">You approved — waiting for others.</span>}
          </div>
        );
      })}
    </div>
  );
}
