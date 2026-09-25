import { useEffect, useMemo, useState } from 'react';
import { useIntegrationStore } from '../store/integrationStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useCan } from '../hooks/useCan';
import { sendTestEvent } from '../api/integrationTriggers';
import { describeDispatch } from '../utils/dispatchSummary';
import { apiErrorMessage } from '../api/client';

const selectClass =
  'w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';
const btnClass =
  'rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800';

/** Every integration trigger in the catalogue, as `<integration>.<trigger>` event names (spec/26 §7). */
export function useIntegrationTriggers() {
  const catalog = useIntegrationStore((s) => s.catalog);
  const loadCatalog = useIntegrationStore((s) => s.loadCatalog);
  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  return useMemo(() => (catalog || []).flatMap((integration) =>
    (integration.triggers || []).map((trigger) => ({
      eventName: `${integration.id}.${trigger.id}`,
      integration,
      trigger,
    }))), [catalog]);
}

/**
 * The External Event card's "From an integration" picker: choosing a trigger
 * fills in the event name; for an integration trigger it also offers an
 * optional connection filter and a "Send test event" button.
 */
export default function IntegrationEventPicker({ eventName, onEventName, connectionId, onConnectionId, readOnly = false }) {
  const triggers = useIntegrationTriggers();
  const workspaceId = useWorkspaceStore((s) => s.current?.id);
  const connections = useIntegrationStore((s) => s.connections);
  const loadConnections = useIntegrationStore((s) => s.loadConnections);
  const canTest = useCan('triggers:manage');
  const [testState, setTestState] = useState(null);

  useEffect(() => { if (workspaceId) loadConnections(workspaceId); }, [workspaceId, loadConnections]);

  const selected = triggers.find((t) => t.eventName === eventName) || null;
  const options = (connections || []).filter((c) => selected && c.integration === selected.integration.id);

  async function test() {
    setTestState({ busy: true });
    try {
      const result = await sendTestEvent(selected.integration.id, selected.trigger.id, connectionId || null);
      setTestState({ message: `Test event sent — ${describeDispatch(result)}.` });
    } catch (err) {
      setTestState({ error: apiErrorMessage(err, 'Could not send the test event') });
    }
  }

  if (!triggers.length) return null;
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
        From an integration
        <select
          className={`${selectClass} mt-0.5`}
          value={selected ? eventName : ''}
          disabled={readOnly}
          onChange={(e) => { onEventName(e.target.value); onConnectionId(null); setTestState(null); }}
        >
          <option value="">— custom event name —</option>
          {triggers.map((t) => (
            <option key={t.eventName} value={t.eventName}>{t.integration.name} · {t.trigger.name}</option>
          ))}
        </select>
      </label>
      {selected && (
        <>
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Only from connection
            <select
              className={`${selectClass} mt-0.5`}
              value={connectionId || ''}
              disabled={readOnly}
              onChange={(e) => onConnectionId(e.target.value || null)}
            >
              <option value="">Any {selected.integration.name} connection</option>
              {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {selected.trigger.description && <p className="text-[11px] text-slate-400">{selected.trigger.description}</p>}
          {canTest && !readOnly && (
            <div className="flex items-center gap-1.5">
              <button type="button" className={btnClass} disabled={testState?.busy} onClick={test}>Send test event</button>
              {testState?.message && <span className="text-[11px] text-green-600 dark:text-green-400">{testState.message}</span>}
              {testState?.error && <span className="text-[11px] text-red-500">{testState.error}</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
