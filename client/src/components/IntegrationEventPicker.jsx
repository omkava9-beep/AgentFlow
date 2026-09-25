import { useEffect, useMemo, useState } from 'react';
import Select from './ui/Select';
import { useIntegrationStore } from '../store/integrationStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useCan } from '../hooks/useCan';
import { sendTestEvent } from '../api/integrationTriggers';
import { describeDispatch } from '../utils/dispatchSummary';
import { apiErrorMessage } from '../api/client';

const btnClass =
  'rounded border border-default px-2 py-1 text-xs font-medium text-fg hover:bg-bg-subtle disabled:opacity-40   ';

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
      <label className="block text-[11px] font-medium text-muted">
        From an integration
        <Select
          size="sm"
          className="mt-0.5"
          aria-label="Integration trigger"
          data-testid="integration-trigger-select"
          value={selected ? eventName : ''}
          disabled={readOnly}
          onChange={(e) => { onEventName(e.target.value); onConnectionId(null); setTestState(null); }}
        >
          <option value="">— custom event name —</option>
          {triggers.map((t) => (
            <option key={t.eventName} value={t.eventName}>{t.integration.name} · {t.trigger.name}</option>
          ))}
        </Select>
      </label>
      {selected && (
        <>
          <label className="block text-[11px] font-medium text-muted">
            Only from connection
            <Select
              size="sm"
              className="mt-0.5"
              aria-label="Connection filter"
              value={connectionId || ''}
              disabled={readOnly}
              onChange={(e) => onConnectionId(e.target.value || null)}
            >
              <option value="">Any {selected.integration.name} connection</option>
              {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </label>
          {selected.trigger.description && <p className="text-[11px] text-subtle">{selected.trigger.description}</p>}
          {canTest && !readOnly && (
            <div className="flex items-center gap-1.5">
              <button type="button" className={btnClass} disabled={testState?.busy} onClick={test}>Send test event</button>
              {testState?.message && <span className="text-[11px] text-success">{testState.message}</span>}
              {testState?.error && <span className="text-[11px] text-danger">{testState.error}</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
