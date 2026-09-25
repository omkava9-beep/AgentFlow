import { useState } from 'react';
import { Button } from './ui';

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

  return (
    <div className={`flex ${compact ? 'items-center gap-2' : 'flex-col gap-2'}`}>
      <input
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Comment (optional)"
        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
      />
      <div className="flex items-center gap-2">
        <Button className="!bg-green-600 !px-3 !py-1 text-sm hover:!bg-green-700" disabled={Boolean(busy)} onClick={() => decide('approve')}>
          {busy === 'approve' ? 'Approving…' : 'Approve'}
        </Button>
        <Button variant="secondary" className="!px-3 !py-1 text-sm !text-red-600" disabled={Boolean(busy)} onClick={() => decide('reject')}>
          {busy === 'reject' ? 'Rejecting…' : 'Reject'}
        </Button>
      </div>
      {message && <p className="text-xs text-slate-500 dark:text-slate-400">{message}</p>}
    </div>
  );
}
