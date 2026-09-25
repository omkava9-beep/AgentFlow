import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../components/ui';
import ApprovalDecision from '../components/ApprovalDecision';
import { decideApproval } from '../api/approvals';
import { usePendingApprovals } from '../hooks/usePendingApprovals';
import { useWorkspacePath } from '../hooks/useWorkspacePath';
import { useCan } from '../hooks/useCan';
import { formatDuration } from '../utils/relativeTime';
import { SkeletonTable } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';

/** spec/32: the Approvals inbox - Pending and Decided tabs, inline decisions. */
export default function Approvals() {
  const wp = useWorkspacePath();
  const canOverride = useCan('runs:approve_any');
  const [tab, setTab] = useState('pending');
  const [all, setAll] = useState(false);
  const { items, error, reload } = usePendingApprovals({ status: tab, all: all && canOverride });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Approvals</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Runs paused until you decide.</p>
        </div>
        {canOverride && (
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            Everyone's approvals
          </label>
        )}
      </div>
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {['pending', 'decided'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm capitalize ${tab === t ? 'border-b-2 border-brand-500 font-medium text-brand-600 dark:text-brand-400' : 'text-slate-500'}`}
          >
            {t}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {items === null && !error && <SkeletonTable rows={3} columns={3} />}
      {items?.length === 0 && (
        <EmptyState
          icon="✋"
          title={tab === 'pending' ? 'Nothing is waiting on you' : 'No decided approvals yet'}
          body={tab === 'pending' ? 'When a run reaches an Approval step assigned to you, it shows up here.' : undefined}
        />
      )}
      {items?.map((a) => (
        <Card key={`${a.runId}:${a.nodeId}`} className="flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="font-medium text-slate-900 dark:text-white">{a.title}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                <Link to={wp(`/runs/${a.runId}`)} className="text-brand-600 hover:underline dark:text-brand-400">{a.workflowName}</Link>
                {a.since && ` · waiting ${formatDuration(Date.now() - new Date(a.since).getTime())}`}
                {tab === 'pending' && a.resumeAt && ` · auto-${a.timeoutOutcome === 'approved' ? 'approves' : 'rejects'} in ${formatDuration(new Date(a.resumeAt).getTime() - Date.now())}`}
                {' · '}{a.approvals.filter((x) => x.decision === 'approved').length} of {a.minApprovals} approvals
                {!a.assignedToMe && ' · not assigned to you'}
              </div>
            </div>
            {tab === 'decided' && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.decision === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {a.decision} by {a.decidedBy === 'timeout' ? 'timeout' : a.decidedBy?.name}
              </span>
            )}
          </div>
          {a.description && <p className="text-sm text-slate-600 dark:text-slate-300">{a.description}</p>}
          {a.input !== undefined && a.input !== null && (
            <pre className="max-h-32 overflow-auto rounded bg-slate-50 p-2 text-xs dark:bg-slate-900">{JSON.stringify(a.input, null, 2)}</pre>
          )}
          {tab === 'pending' && (
            <ApprovalDecision
              compact
              onDecide={async (decision, comment) => {
                const result = await decideApproval(a.runId, a.nodeId, decision, comment);
                reload();
                return result;
              }}
            />
          )}
        </Card>
      ))}
    </div>
  );
}
