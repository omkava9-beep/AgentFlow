import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2, Workflow } from 'lucide-react';
import { Dialog, Button, Field, Input } from './ui/index';
import { useWorkspacePath } from '../hooks/useWorkspacePath';

/**
 * Delete confirmation. A connection still used by workflows lists them and
 * needs its name typed (spec/25), since those nodes start failing with
 * "Connection not found".
 */
export default function ConnectionDeleteDialog({ connection, usage = [], onConfirm, onClose, busy, error }) {
  const [typed, setTyped] = useState('');
  const wp = useWorkspacePath();
  const inUse = usage.length > 0;

  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!busy}
      title={`Delete “${connection.name}”?`}
      description={inUse ? undefined : 'No workflow uses it. This can’t be undone.'}
      icon={Trash2}
      size="md"
      testId="connection-delete-dialog"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" loading={busy} disabled={inUse && typed !== connection.name} onClick={() => onConfirm(inUse)}>
            Delete connection
          </Button>
        </>
      )}
    >
      {inUse && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            It&rsquo;s used by {usage.length} workflow{usage.length > 1 ? 's' : ''}. Those nodes will fail with
            &ldquo;Connection not found&rdquo; until they&rsquo;re given another connection.
          </p>
          <ul className="max-h-44 divide-y divide-default overflow-y-auto rounded-card border border-default">
            {usage.map((u) => (
              <li key={u.workflowId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <Link to={wp(`/workflows/${u.workflowId}`)} className="flex min-w-0 items-center gap-2 text-fg hover:text-accent">
                  <Workflow className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden="true" />
                  <span className="truncate">{u.workflowName || u.workflowId}</span>
                </Link>
                <span className="shrink-0 text-xs tabular-nums text-subtle">
                  {(u.nodeIds || []).length} node{(u.nodeIds || []).length === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
          <Field label={<>Type <span className="font-mono">{connection.name}</span> to confirm</>} htmlFor="confirm-connection-name">
            <Input id="confirm-connection-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </Field>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
    </Dialog>
  );
}
