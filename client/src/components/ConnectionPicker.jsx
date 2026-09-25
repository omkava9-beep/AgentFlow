import { useState } from 'react';
import { useCan } from '../hooks/useCan';
import { useIntegrationStore, connectionById } from '../store/integrationStore';
import { needsCredentials } from '../utils/integrationCatalog';
import ConnectionDialog from './ConnectionDialog';
import { Select } from './ui';

const NEW = '__new__';
const STATUS_TEXT = { ok: '', error: ' · error', untested: ' · untested' };

/**
 * The Connection select under the action picker (spec/25 UI). Options are this
 * workspace's connections for the node's integration, "Sandbox (no account)",
 * "None — live" for integrations that need no credentials, and "+ New
 * connection…" for roles with `connections:manage`.
 *
 * `value` is `ObjectId | 'sandbox' | null`; the select's empty string maps to null.
 */
export default function ConnectionPicker({ integration, value, onChange, readOnly = false }) {
  const canManage = useCan('connections:manage');
  const canUse = useCan('connections:use');
  const connections = useIntegrationStore((s) => s.connections);
  const upsertConnection = useIntegrationStore((s) => s.upsertConnection);
  const [dialog, setDialog] = useState(false);

  if (!integration) return null;

  const mine = (connections || []).filter((c) => c.integration === integration.id);
  const selected = value && value !== 'sandbox' ? connectionById(connections, value) : null;
  const dangling = value && value !== 'sandbox' && connections && !selected;
  const credentialed = needsCredentials(integration);

  function handleChange(next) {
    if (next === NEW) {
      setDialog(true);
      return;
    }
    onChange(next === '' ? null : next);
  }

  return (
    <div>
      <Select
        label="Connection"
        value={value ?? ''}
        disabled={readOnly || !canUse}
        onChange={(e) => handleChange(e.target.value)}
      >
        {credentialed ? (
          <option value="">{mine.length ? 'Select a connection…' : 'No connection — runs in sandbox'}</option>
        ) : (
          <option value="">None — live</option>
        )}
        {mine.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.mode === 'sandbox' ? ' (sandbox)' : ''}
            {STATUS_TEXT[c.status] ?? ''}
          </option>
        ))}
        <option value="sandbox">Sandbox (no account)</option>
        {dangling && <option value={value}>Missing connection ({String(value).slice(-6)})</option>}
        {canManage && !readOnly && <option value={NEW}>+ New connection…</option>}
      </Select>

      {dangling && (
        <p className="mt-1 text-xs text-warning">
          The selected connection no longer exists — this node will fail until you pick another.
        </p>
      )}
      {selected?.status === 'error' && (
        <p className="mt-1 text-xs text-warning">
          Last test failed{selected.lastError ? `: ${selected.lastError}` : ''}.
        </p>
      )}
      {credentialed && !mine.length && !canManage && !readOnly && (
        <p className="mt-1 text-xs text-subtle">Ask an admin to add a {integration.name} connection.</p>
      )}

      {dialog && (
        <ConnectionDialog
          integration={integration}
          onClose={() => setDialog(false)}
          onSaved={(saved) => {
            upsertConnection(saved);
            onChange(saved.id);
          }}
        />
      )}
    </div>
  );
}
