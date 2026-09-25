import { useEffect, useState } from 'react';
import { Checkbox } from '../ui/Form';
import { diffVersions, publishWorkflow } from '../../api/workflows';
import { apiErrorMessage } from '../../api/client';
import { useToastStore } from '../../store/toastStore';
import { TextArea, Button, ErrorText } from '../ui';
import { summarizeDiff } from './diffSummary';

/**
 * spec/30 publish dialog: the draft ↔ live summary, the warnings (with the
 * required "I understand"), and an optional message. Errors disable Publish;
 * the server re-validates regardless and may know things the client doesn't.
 */
export default function PublishDialog({ workflowId, publishedVersion, errors: clientErrors, warnings: clientWarnings, onViewDiff, onClose, onPublished }) {
  const [message, setMessage] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);
  const [server, setServer] = useState(null); // { errors, warnings } from a 422

  useEffect(() => {
    if (!publishedVersion) return;
    diffVersions(workflowId, publishedVersion, 'draft').then((d) => setSummary(summarizeDiff(d.diff))).catch(() => {});
  }, [workflowId, publishedVersion]);

  const errors = server?.errors?.length ? server.errors : clientErrors;
  const warnings = server?.warnings?.length ? server.warnings : clientWarnings;

  async function handlePublish() {
    setBusy(true);
    setError('');
    try {
      const { version } = await publishWorkflow(workflowId, { message: message.trim() || undefined, acknowledgeWarnings: ack });
      useToastStore.getState().push(`Published v${version.version}${version.warningsCount ? ` with ${version.warningsCount} warning${version.warningsCount === 1 ? '' : 's'}` : ''}.`, 'info');
      onPublished?.(version);
      onClose();
    } catch (err) {
      const data = err?.response?.data;
      if (err?.response?.status === 422 && data) setServer({ errors: data.errors || [], warnings: data.warnings || [] });
      setError(apiErrorMessage(err, 'Publishing failed'));
    } finally {
      setBusy(false);
    }
  }

  const blocked = errors.length > 0 || (warnings.length > 0 && !ack);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-surface-sunken/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-default bg-surface p-5 shadow-xl">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-subtle">Publish</h3>
        <p className="mt-1 text-sm text-muted">
          {publishedVersion
            ? <>Publishing makes this draft <strong>v{publishedVersion + 1}</strong>. Schedules, webhooks, events and API calls switch to it immediately.</>
            : <>This will be the first version. Until then, schedules, webhooks, events and API calls don't run this workflow.</>}
        </p>

        {publishedVersion && (
          <p className="mt-3 rounded-lg bg-bg-subtle px-3 py-2 text-xs text-muted">
            Draft vs live v{publishedVersion}: {summary ?? 'comparing…'}{' '}
            {onViewDiff && (
              <button type="button" className="text-accent hover:underline" onClick={() => { onClose(); onViewDiff(); }}>
                View diff
              </button>
            )}
          </p>
        )}

        {errors.length > 0 && (
          <div className="mt-3 rounded-lg bg-danger-subtle px-3 py-2 text-xs text-danger-subtle-fg">
            <p className="font-semibold">Fix these before publishing:</p>
            <ul className="mt-1 list-disc pl-4">{errors.map((e) => <li key={e.id}>{e.message}</li>)}</ul>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="mt-3 rounded-lg bg-warning-subtle px-3 py-2 text-xs text-warning-subtle-fg">
            <p className="font-semibold">{warnings.length} warning{warnings.length === 1 ? '' : 's'}:</p>
            <ul className="mt-1 list-disc pl-4">{warnings.map((w) => <li key={w.id}>{w.message}</li>)}</ul>
            <label className="mt-2 flex items-center gap-2 font-medium">
              <Checkbox checked={ack} onChange={(e) => setAck(e.target.checked)} />
              I understand — publish anyway
            </label>
          </div>
        )}

        <div className="mt-4 space-y-3">
          <TextArea label="Message (optional)" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What changed?" />
          <ErrorText>{error}</ErrorText>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={handlePublish} disabled={busy || blocked} title={errors.length ? 'Fix the errors first' : undefined}>
              {busy ? 'Publishing…' : 'Publish'}
            </Button>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
