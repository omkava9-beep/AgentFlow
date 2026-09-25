import { useState } from 'react';
import { createShareLink, deleteShareLink } from '../api/share';
import { apiErrorMessage } from '../api/client';
import { Button, ErrorText } from './ui';
import { confirm } from './ui/confirm';

/** Share action for the Builder (spec/18): generate, copy, revoke. */
export default function ShareDialog({ workflowId, initialToken, onTokenChange, onClose }) {
  const [token, setToken] = useState(initialToken || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const url = token ? `${window.location.origin}/shared/${token}` : null;

  async function run(fn) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(apiErrorMessage(err, 'Share action failed'));
    } finally {
      setBusy(false);
    }
  }

  const generate = () =>
    run(async () => {
      if (token && !(await confirm({ title: 'Generate a new link?', body: 'The current link stops working immediately.', confirmLabel: 'Generate new link', destructive: true }))) return;
      const saved = await createShareLink(workflowId);
      setToken(saved.shareToken);
      onTokenChange(saved.shareToken);
    });

  const revoke = () =>
    run(async () => {
      if (!(await confirm({ title: 'Disable sharing?', body: 'The existing link will stop working immediately.', confirmLabel: 'Disable sharing', destructive: true }))) return;
      await deleteShareLink(workflowId);
      setToken(null);
      onTokenChange(null);
    });

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Clipboard unavailable — select and copy the link manually.');
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-surface-sunken/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-default bg-surface p-5 shadow-xl">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-subtle">Share read-only link</h3>
        <p className="mt-1 text-xs text-muted">
          Anyone with the link can view this workflow's design and recent runs without signing in. They cannot
          edit it, run it, or see its webhook and schedule settings.
        </p>

        <div className="mt-4 space-y-3">
          {url ? (
            <>
              <code className="block break-all rounded bg-bg-subtle p-2 text-xs text-fg">
                {url}
              </code>
              <div className="flex flex-wrap gap-2">
                <Button onClick={copy} disabled={busy}>{copied ? 'Copied' : 'Copy link'}</Button>
                <Button variant="secondary" onClick={generate} disabled={busy}>Generate new link</Button>
                <Button variant="danger" onClick={revoke} disabled={busy}>Disable sharing</Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">Sharing is off for this workflow.</p>
              <Button onClick={generate} disabled={busy}>{busy ? 'Creating...' : 'Create share link'}</Button>
            </>
          )}

          <ErrorText>{error}</ErrorText>
          <Button variant="secondary" className="w-full" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}
