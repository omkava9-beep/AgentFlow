import { useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import {
  putSchedule, deleteSchedule,
  regenerateWebhook, putWebhook,
  putEventTrigger, deleteEventTrigger,
} from '../api/workflows';
import { apiErrorMessage, API_BASE_URL } from '../api/client';
import { describeCron, nextRun, parseCron } from '../utils/cron';
import { Link } from 'react-router-dom';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useWorkspacePath } from '../hooks/useWorkspacePath';
import IntegrationEventPicker from './IntegrationEventPicker';
import { confirm } from './ui/confirm';

// `readOnly` (viewers, spec/23) keeps sections expandable but disables every
// control inside them; the server rejects trigger changes regardless.
function Section({ title, active, readOnly = false, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-default bg-surface">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-2.5 py-2 text-left text-xs font-medium text-fg"
      >
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-success' : 'bg-surface-sunken '}`} />
          {title}
        </span>
        <span className="text-subtle">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <fieldset disabled={readOnly} className="space-y-2 border-t border-default px-2.5 py-2">
          {children}
        </fieldset>
      )}
    </div>
  );
}

// Derived from the configured API base rather than rewriting the browser's port,
// so these URLs stay correct wherever the API actually lives.
const API_BASE = API_BASE_URL;

const inputClass =
  'w-full rounded border border-default bg-surface px-2 py-1 text-xs text-fg focus:border-accent focus:outline-none   ';
const btnClass =
  'rounded border border-default px-2 py-1 text-xs font-medium text-fg hover:bg-bg-subtle disabled:opacity-40   ';

/**
 * Events are addressed per workspace and need an API key (spec/24): a global,
 * unauthenticated event name let tenants fire each other's workflows.
 */
function EventCurl({ eventName }) {
  const slug = useWorkspaceStore((s) => s.current?.slug);
  const wp = useWorkspacePath();
  return (
    <>
      <code className="block whitespace-pre-wrap break-all rounded bg-bg-subtle p-1.5 text-[10px] text-fg">
        {`curl -X POST ${API_BASE}/w/${slug}/events/${eventName} \\\n  -H "Authorization: Bearer <YOUR_API_KEY>" \\\n  -H "Content-Type: application/json" -d '{}'`}
      </code>
      <p className="text-[11px] text-subtle">
        Needs a key with the <span className="font-mono">events:publish</span> scope —{' '}
        <Link to={wp('/settings/api-keys')} className="font-medium text-accent hover:underline">
          manage API keys
        </Link>
        . Renaming the workspace URL changes this address.
      </p>
    </>
  );
}

export default function TriggerPanel({ workflowId, readOnly = false }) {
  const { triggers, setTrigger } = useWorkflowStore();
  const [cronDraft, setCronDraft] = useState(triggers.schedule?.cronExpression || '');
  const [eventDraft, setEventDraft] = useState(triggers.eventTrigger?.eventName || '');
  const [eventConnection, setEventConnection] = useState(triggers.eventTrigger?.connectionId || null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const schedule = triggers.schedule;
  const webhook = triggers.webhook;
  const eventTrigger = triggers.eventTrigger;

  const cronCheck = cronDraft.trim() ? parseCron(cronDraft.trim()) : null;
  const cronDescription = cronCheck?.valid ? describeCron(cronDraft.trim()) : null;
  const upcoming = cronCheck?.valid ? nextRun(cronDraft.trim()) : null;

  // Forwards args: without `...args` a call like `applySchedule(true)` would be
  // swallowed and fall back to the current (disabled) value.
  const guard = (fn) => async (...args) => {
    setError('');
    try {
      await fn(...args);
    } catch (err) {
      setError(apiErrorMessage(err, 'Trigger update failed'));
    }
  };

  const applySchedule = guard(async (enabled = schedule?.enabled) => {
    const saved = await putSchedule(workflowId, { cronExpression: cronDraft.trim(), enabled });
    setTrigger('schedule', saved);
  });

  const clearSchedule = guard(async () => {
    await deleteSchedule(workflowId);
    setTrigger('schedule', { cronExpression: null, enabled: false });
    setCronDraft('');
  });

  const generateWebhook = guard(async () => {
    // Regenerating invalidates the existing URL, so make that explicit.
    if (webhook?.token && !(await confirm({ title: 'Regenerate the webhook URL?', body: 'The current URL stops working immediately; anything calling it must be updated.', confirmLabel: 'Regenerate', destructive: true }))) return;
    const saved = await regenerateWebhook(workflowId);
    setTrigger('webhook', { token: saved.token, enabled: true, url: saved.url });
  });

  const toggleWebhook = guard(async () => {
    const saved = await putWebhook(workflowId, { enabled: !webhook?.enabled });
    setTrigger('webhook', saved);
  });

  const applyEvent = guard(async (enabled = eventTrigger?.enabled) => {
    const saved = await putEventTrigger(workflowId, { eventName: eventDraft.trim(), enabled, connectionId: eventConnection || null });
    setTrigger('eventTrigger', saved);
  });

  const clearEvent = guard(async () => {
    await deleteEventTrigger(workflowId);
    setTrigger('eventTrigger', { eventName: null, enabled: false, connectionId: null });
    setEventDraft('');
    setEventConnection(null);
  });

  const webhookUrl = webhook?.url || (webhook?.token ? `${API_BASE}/hooks/${webhook.token}` : null);

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Clipboard unavailable — select and copy manually.');
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-subtle">Triggers</h3>

      <div className="rounded-lg border border-accent bg-accent-subtle px-2.5 py-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-medium text-fg">Manual</span>
          <span className="rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-medium uppercase text-white">Active</span>
        </div>
        <p className="mt-0.5 text-muted">The Run button above.</p>
      </div>

      <Section title="Scheduled (Cron)" active={Boolean(schedule?.enabled)} readOnly={readOnly}>
        <input value={cronDraft} onChange={(e) => setCronDraft(e.target.value)} placeholder="0 * * * *" className={inputClass} />
        {cronDraft.trim() && !cronCheck?.valid && <p className="text-[11px] text-danger">{cronCheck?.error}</p>}
        {cronDescription && <p className="text-[11px] text-muted">Runs {cronDescription}.</p>}
        {upcoming && <p className="text-[11px] text-subtle">Next: {upcoming.toLocaleString()}</p>}
        <div className="flex gap-1.5">
          <button className={btnClass} disabled={!cronCheck?.valid} onClick={() => applySchedule(true)}>
            {schedule?.enabled ? 'Update' : 'Enable'}
          </button>
          {schedule?.enabled && (
            <button className={btnClass} onClick={() => applySchedule(false)}>Disable</button>
          )}
          {schedule?.cronExpression && <button className={btnClass} onClick={clearSchedule}>Clear</button>}
        </div>
        {schedule?.enabled && (
          <p className="text-[11px] text-success">Active: {schedule.cronExpression}</p>
        )}
      </Section>

      <Section title="Webhook" active={Boolean(webhook?.enabled && webhook?.token)} readOnly={readOnly}>
        {readOnly ? (
          // The URL is a capability to start runs, so it isn't shown to viewers.
          <p className="text-[11px] text-muted">
            {webhook?.enabled && webhook?.token ? 'Webhook trigger is enabled.' : 'No webhook trigger.'}
          </p>
        ) : webhookUrl ? (
          <>
            <code className="block break-all rounded bg-bg-subtle p-1.5 text-[10px] text-fg">
              {webhookUrl}
            </code>
            <div className="flex flex-wrap gap-1.5">
              <button className={btnClass} onClick={() => copy(webhookUrl)}>{copied ? 'Copied' : 'Copy'}</button>
              <button className={btnClass} onClick={toggleWebhook}>{webhook.enabled ? 'Disable' : 'Enable'}</button>
              <button className={btnClass} onClick={generateWebhook}>Regenerate</button>
            </div>
            <p className="text-[11px] text-subtle">
              POST here to start a run. A JSON body becomes the Start node's output.
            </p>
          </>
        ) : (
          <>
            <p className="text-[11px] text-muted">No webhook URL yet.</p>
            <button className={btnClass} onClick={generateWebhook}>Generate URL</button>
          </>
        )}
      </Section>

      <Section title="External Event" active={Boolean(eventTrigger?.enabled && eventTrigger?.eventName)} readOnly={readOnly}>
        <IntegrationEventPicker
          eventName={eventDraft.trim()}
          onEventName={setEventDraft}
          connectionId={eventConnection}
          onConnectionId={setEventConnection}
          readOnly={readOnly}
        />
        <input value={eventDraft} onChange={(e) => setEventDraft(e.target.value)} placeholder="order.created" className={inputClass} />
        <div className="flex gap-1.5">
          <button className={btnClass} disabled={!eventDraft.trim()} onClick={() => applyEvent(true)}>
            {eventTrigger?.enabled ? 'Update' : 'Subscribe'}
          </button>
          {eventTrigger?.enabled && <button className={btnClass} onClick={() => applyEvent(false)}>Disable</button>}
          {eventTrigger?.eventName && <button className={btnClass} onClick={clearEvent}>Clear</button>}
        </div>
        {eventTrigger?.enabled && (
          <>
            <p className="text-[11px] text-success">Subscribed to {eventTrigger.eventName}</p>
            {/* A trigger nobody can work out how to fire isn't a demoable trigger. */}
            <EventCurl eventName={eventTrigger.eventName} />
          </>
        )}
        <p className="text-[11px] text-subtle">
          One event name fans out to every workflow in this workspace subscribed to it — unlike a webhook, which targets just this one.
        </p>
      </Section>

      {error && <p className="text-[11px] text-danger">{error}</p>}
    </div>
  );
}
