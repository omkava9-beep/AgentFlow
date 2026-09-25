import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button, Input, Textarea } from './ui';

/**
 * Approve / Reject with an optional comment. `onDecide(decision, comment)`
 * returns a promise; a 409 means someone else decided first, and the message
 * says who.
 */
export default function ApprovalDecision({ onDecide, compact = false }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState('');

  async function decide(decision) {
    setBusy(decision);
    setMessage('');
    try {
      const result = await onDecide(decision, comment);
      if (result?.status === 'waiting') setMessage(`Approval recorded — ${result.approvals} of ${result.needed} so far.`);
      setComment('');
    } catch (err) {
      const body = err?.response?.data;
      if (err?.response?.status === 409 && body?.decision) {
        const who = body.decidedBy === 'timeout' ? 'the timeout' : body.decidedBy?.name || 'someone';
        setMessage(`Already ${body.decision} by ${who}.`);
      } else {
        setMessage(body?.error || 'Could not record the decision.');
      }
    } finally {
      setBusy(null);
    }
  }

  const buttons = (
    <div className="flex items-center gap-2">
      <Button size={compact ? 'sm' : 'md'} icon={Check} loading={busy === 'approve'} disabled={Boolean(busy)} onClick={() => decide('approve')}>
        Approve
      </Button>
      <Button size={compact ? 'sm' : 'md'} variant="danger-ghost" icon={X} loading={busy === 'reject'} disabled={Boolean(busy)} onClick={() => decide('reject')}>
        Reject
      </Button>
    </div>
  );

  return (
    <div className={compact ? 'flex flex-wrap items-center gap-2' : 'flex flex-col gap-3'}>
      {compact ? (
        <Input size="sm" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (optional)" aria-label="Comment" className="w-56 min-w-0 flex-1" />
      ) : (
        <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment for the audit trail (optional)" aria-label="Comment" />
      )}
      {buttons}
      {message && <p className="w-full text-xs text-muted">{message}</p>}
    </div>
  );
}
