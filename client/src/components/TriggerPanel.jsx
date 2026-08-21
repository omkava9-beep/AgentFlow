import { useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import {
  putSchedule, deleteSchedule,
  regenerateWebhook, putWebhook,
  putEventTrigger, deleteEventTrigger,
} from '../api/workflows';
import { apiErrorMessage } from '../api/client';
import { describeCron, nextRun, parseCron } from '../utils/cron';

function Section({ title, active, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-2.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200"
      >
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
          {title}
        </span>
        <span className="text-slate-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="space-y-2 border-t border-slate-100 px-2.5 py-2 dark:border-slate-800">{children}</div>}
    </div>
  );
}

// Derived from the configured API base rather than rewriting the browser's port,
// so these URLs stay correct wherever the API actually lives.
const API_BASE = String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

const inputClass =
  'w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';
const btnClass =
  'rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800';

export default function TriggerPanel({ workflowId }) {
  const { triggers, setTrigger } = useWorkflowStore();
  const [cronDraft, setCronDraft] = useState(triggers.schedule?.cronExpression || '');
  const [eventDraft, setEventDraft] = useState(triggers.eventTrigger?.eventName || '');
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
    if (webhook?.token && !window.confirm('Regenerating invalidates the current webhook URL immediately. Continue?')) return;
    const saved = await regenerateWebhook(workflowId);
    setTrigger('webhook', { token: saved.token, enabled: true, url: saved.url });
  });

  const toggleWebhook = guard(async () => {
    const saved = await putWebhook(workflowId, { enabled: !webhook?.enabled });
    setTrigger('webhook', saved);
  });

  const applyEvent = guard(async (enabled = eventTrigger?.enabled) => {
    const saved = await putEventTrigger(workflowId, { eventName: eventDraft.trim(), enabled });
    setTrigger('eventTrigger', saved);
  });

  const clearEvent = guard(async () => {
    await deleteEventTrigger(workflowId);
    setTrigger('eventTrigger', { eventName: null, enabled: false });
    setEventDraft('');
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
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Triggers</h3>

      <div className="rounded-lg border border-brand-400 bg-brand-50 px-2.5 py-2 text-xs dark:border-brand-600 dark:bg-brand-950/40">
        <div className="flex items-center justify-between">
          <span className="font-medium text-slate-800 dark:text-slate-100">Manual</span>
          <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[9px] font-medium uppercase text-white">Active</span>
        </div>
        <p className="mt-0.5 text-slate-500 dark:text-slate-400">The Run button above.</p>
      </div>

      <Section title="Scheduled (Cron)" active={Boolean(schedule?.enabled)}>
        <input value={cronDraft} onChange={(e) => setCronDraft(e.target.value)} placeholder="0 * * * *" className={inputClass} />
        {cronDraft.trim() && !cronCheck?.valid && <p className="text-[11px] text-red-500">{cronCheck?.error}</p>}
        {cronDescription && <p className="text-[11px] text-slate-500 dark:text-slate-400">Runs {cronDescription}.</p>}
        {upcoming && <p className="text-[11px] text-slate-400">Next: {upcoming.toLocaleString()}</p>}
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
          <p className="text-[11px] text-green-600 dark:text-green-400">Active: {schedule.cronExpression}</p>
        )}
      </Section>

      <Section title="Webhook" active={Boolean(webhook?.enabled && webhook?.token)}>
        {webhookUrl ? (
          <>
            <code className="block break-all rounded bg-slate-100 p-1.5 text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {webhookUrl}
            </code>
            <div className="flex flex-wrap gap-1.5">
              <button className={btnClass} onClick={() => copy(webhookUrl)}>{copied ? 'Copied' : 'Copy'}</button>
              <button className={btnClass} onClick={toggleWebhook}>{webhook.enabled ? 'Disable' : 'Enable'}</button>
              <button className={btnClass} onClick={generateWebhook}>Regenerate</button>
            </div>
            <p className="text-[11px] text-slate-400">
              POST here to start a run. A JSON body becomes the Start node's output.
            </p>
          </>
        ) : (
          <>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">No webhook URL yet.</p>
            <button className={btnClass} onClick={generateWebhook}>Generate URL</button>
          </>
        )}
      </Section>

      <Section title="External Event" active={Boolean(eventTrigger?.enabled && eventTrigger?.eventName)}>
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
            <p className="text-[11px] text-green-600 dark:text-green-400">Subscribed to {eventTrigger.eventName}</p>
            {/* A trigger nobody can work out how to fire isn't a demoable trigger. */}
            <code className="block break-all rounded bg-slate-100 p-1.5 text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {`curl -X POST ${API_BASE}/events/${eventTrigger.eventName}`}
            </code>
          </>
        )}
        <p className="text-[11px] text-slate-400">
          One event name fans out to every workflow subscribed to it — unlike a webhook, which targets just this one.
        </p>
      </Section>

      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
