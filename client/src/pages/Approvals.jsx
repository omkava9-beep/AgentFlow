import { useState } from 'react';
import { Link } from 'react-router-dom';
import { UserCheck, Check, X, Timer, Inbox, CheckCircle2, XCircle, ChevronRight } from 'lucide-react';
import { decideApproval } from '../api/approvals';
import { usePendingApprovals } from '../hooks/usePendingApprovals';
import { useWorkspacePath } from '../hooks/useWorkspacePath';
import { useCan } from '../hooks/useCan';
import { formatDuration } from '../utils/relativeTime';
import {
  PageHeader, Tabs, Switch, Card, Badge, Button, Dialog, Textarea, AvatarStack, EmptyState, SkeletonTable, cx,
} from '../components/ui';
import TriggerBadge from '../components/TriggerBadge';
import JsonView from '../components/runs/JsonView';
import { RelativeTime } from '../components/runs/RunBits';
import { shortId } from '../utils/runIds';

/** Approve / Reject confirmation with a comment for the audit trail. */
function DecisionDialog({ item, decision, onClose, onDone }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const approve = decision === 'approve';

  async function submit() {
    setBusy(true);
    setMessage('');
    try {
      const result = await decideApproval(item.runId, item.nodeId, decision, comment);
      onDone(result);
    } catch (err) {
      const body = err?.response?.data;
      if (err?.response?.status === 409 && body?.decision) {
        const who = body.decidedBy === 'timeout' ? 'the timeout' : body.decidedBy?.name || 'someone';
        setMessage(`Already ${body.decision} by ${who}.`);
      } else {
        setMessage(body?.error || 'Could not record the decision.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      icon={approve ? CheckCircle2 : XCircle}
      title={approve ? 'Approve this request?' : 'Reject this request?'}
      description={`${item.title} · ${item.workflowName}`}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={approve ? 'primary' : 'danger'} icon={approve ? Check : X} loading={busy} onClick={submit}>
            {approve ? 'Approve' : 'Reject'}
          </Button>
        </>
      )}
    >
      <p className="mb-2 text-sm text-muted">
        {approve
          ? 'The run continues down its approved branch as soon as enough approvals are in.'
          : 'The run continues down its rejected branch immediately.'}
      </p>
      <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (optional) — recorded in the audit log" aria-label="Comment" />
      {message && <p className="mt-2 text-xs text-danger">{message}</p>}
    </Dialog>
  );
}

function ApprovalItem({ a, tab, wp, onDecide }) {
  const [showInput, setShowInput] = useState(false);
  const approved = a.approvals.filter((x) => x.decision === 'approved').length;
  const decided = tab === 'decided';
  const timeLeft = !decided && a.resumeAt ? new Date(a.resumeAt).getTime() - Date.now() : null;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start gap-4">
        <span className={cx(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          decided ? (a.decision === 'approved' ? 'bg-success-subtle text-success-subtle-fg' : 'bg-danger-subtle text-danger-subtle-fg') : 'bg-warning-subtle text-warning-subtle-fg',
        )}>
          {decided ? (a.decision === 'approved' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />) : <UserCheck className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-fg">{a.title}</p>
            {!a.assignedToMe && <Badge size="xs">Not assigned to you</Badge>}
            {decided && (
              <Badge size="xs" tone={a.decision === 'approved' ? 'success' : 'danger'}>
                {a.decision === 'approved' ? 'Approved' : 'Rejected'} by {a.decidedBy === 'timeout' ? 'timeout' : a.decidedBy?.name || 'someone'}
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <Link to={wp(`/workflows/${a.workflowId}`)} className="font-medium text-fg hover:underline">{a.workflowName}</Link>
            <Link to={wp(`/runs/${a.runId}`)} className="inline-flex items-center gap-0.5 font-mono text-accent hover:underline">
              {shortId(a.runId)}<ChevronRight className="h-3 w-3" aria-hidden="true" />
            </Link>
            {a.trigger && <TriggerBadge trigger={a.trigger} />}
            {decided
              ? a.decidedAt && <span>Decided <RelativeTime value={a.decidedAt} /></span>
              : a.since && <span>Waiting {formatDuration(Date.now() - new Date(a.since).getTime())}</span>}
            {timeLeft !== null && (
              <span className="inline-flex items-center gap-1 text-warning">
                <Timer className="h-3 w-3" aria-hidden="true" />
                Auto-{a.timeoutOutcome === 'approved' ? 'approves' : 'rejects'} in {formatDuration(timeLeft)}
              </span>
            )}
          </div>
          {a.description && <p className="mt-2 text-sm text-muted">{a.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-subtle">
            {a.assignees?.length > 0 && (
              <span className="inline-flex items-center gap-1.5"><AvatarStack people={a.assignees} size="xs" max={5} />{a.assignees.map((p) => p.name).join(', ')}</span>
            )}
            <Badge size="xs" tone="warning">{approved} of {a.minApprovals || 1} approvals</Badge>
            {a.input !== undefined && a.input !== null && (
              <button type="button" onClick={() => setShowInput((v) => !v)} className="inline-flex items-center gap-1 font-medium text-muted hover:text-fg" aria-expanded={showInput}>
                <ChevronRight className={cx('h-3 w-3 transition-transform', showInput && 'rotate-90')} aria-hidden="true" />
                Request details
              </button>
            )}
          </div>
          {showInput && <div className="mt-2"><JsonView value={a.input} maxHeight="max-h-56" /></div>}
        </div>
        {!decided && (
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="danger-ghost" icon={X} onClick={() => onDecide(a, 'reject')}>Reject</Button>
            <Button size="sm" icon={Check} onClick={() => onDecide(a, 'approve')}>Approve</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

/** spec/32: the Approvals inbox - Pending and Decided tabs, decisions with a comment. */
export default function Approvals() {
  const wp = useWorkspacePath();
  const canOverride = useCan('runs:approve_any');
  const [tab, setTab] = useState('pending');
  const [all, setAll] = useState(false);
  const [pendingDecision, setPendingDecision] = useState(null);
  const { items, error, reload } = usePendingApprovals({ status: tab, all: all && canOverride });

  return (
    <div>
      <PageHeader
        icon={UserCheck}
        title="Approvals"
        description="Runs paused at an Approval step until someone decides."
        actions={canOverride && <Switch checked={all} onChange={setAll} label="Everyone's approvals" size="sm" />}
        tabs={(
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { value: 'pending', label: 'Pending', icon: Inbox, count: tab === 'pending' && items ? items.length : undefined },
              { value: 'decided', label: 'Decided', icon: CheckCircle2 },
            ]}
          />
        )}
      />
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      {items === null && !error && <SkeletonTable rows={3} columns={3} />}
      {items?.length === 0 && (
        <EmptyState
          icon={tab === 'pending' ? Inbox : CheckCircle2}
          title={tab === 'pending' ? 'Nothing is waiting on you' : 'No decided approvals yet'}
          body={tab === 'pending' ? 'When a run reaches an Approval step assigned to you, it shows up here.' : 'Approvals you or your team decide are listed here.'}
        />
      )}
      <div className="space-y-3">
        {items?.map((a) => (
          <ApprovalItem key={`${a.runId}:${a.nodeId}`} a={a} tab={tab} wp={wp} onDecide={(item, decision) => setPendingDecision({ item, decision })} />
        ))}
      </div>
      {pendingDecision && (
        <DecisionDialog
          item={pendingDecision.item}
          decision={pendingDecision.decision}
          onClose={() => setPendingDecision(null)}
          onDone={() => { setPendingDecision(null); reload(); }}
        />
      )}
    </div>
  );
}
