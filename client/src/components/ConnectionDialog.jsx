import { useMemo, useState } from 'react';
import { createConnection, updateConnection, testConnection, createInboundToken } from '../api/connections';
import { apiErrorMessage } from '../api/client';
import { actionIsLive, integrationIcon } from '../utils/integrationCatalog';
import { useIntegrationStore } from '../store/integrationStore';
import ToolConfigFields from './ToolConfigFields';
import McpConnectionFields from './McpConnectionFields';
import { mcpPayload, mcpFormError } from '../utils/mcpConnection';
import McpToolList from './McpToolList';
import { Button, TextField, ErrorText } from './ui';

/**
 * Create/edit form for one connection (spec/25). Used from the Connections page
 * and inline from the Node Config Panel's "+ New connection…".
 *
 * Auth fields are split by the manifest: `secret: true` ones go under
 * `credentials` (encrypted server-side), the rest under plain `config`. On
 * edit, secret fields start empty — only non-empty values and explicit clears
 * (`null`) are sent, so "leave blank to keep" never needs the token on the client.
 */
export default function ConnectionDialog({ integration, connection = null, onClose, onSaved }) {
  const liveEnabled = useIntegrationStore((s) => s.liveEnabled);
  const fields = useMemo(() => integration?.auth?.fields || [], [integration]);
  // spec/37: MCP has no static actions — its tools are discovered per connection.
  const isMcp = integration?.id === 'mcp';
  const hasLiveActions =
    (integration?.actions || []).some(actionIsLive) || Boolean(integration?.dynamicActions || integration?.liveCapable);
  const liveBlocked = !hasLiveActions || liveEnabled === false;

  const [name, setName] = useState(connection?.name || `${integration?.name || 'New'} connection`);
  const [mode, setMode] = useState(connection?.mode || (hasLiveActions ? 'live' : 'sandbox'));
  const [values, setValues] = useState(() => {
    const initial = {};
    if (isMcp) {
      const c = connection?.config || {};
      return { transport: c.transport || 'http', url: c.url || '', headerName: c.headerName || '', allowlistId: c.allowlistId || '' };
    }
    for (const f of fields) {
      if (!f.secret && connection?.config?.[f.key] !== undefined) initial[f.key] = connection.config[f.key];
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [inboundUrl, setInboundUrl] = useState(connection?.inboundUrl || null);
  // The connection as last saved, so a new MCP connection can list its tools
  // right after "Save & test" without closing the dialog.
  const [savedConnection, setSavedConnection] = useState(connection);
  const [saveCount, setSaveCount] = useState(0);
  const formError = isMcp ? mcpFormError(values) : null;

  async function generateInbound() {
    try {
      const { inboundUrl: url } = await createInboundToken(connection.id);
      setInboundUrl(url);
      onSaved?.({ ...connection, inboundUrl: url });
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to generate inbound URL'));
    }
  }

  function splitPayload() {
    if (isMcp) return mcpPayload(values, connection);
    const credentials = {};
    const config = {};
    for (const f of fields) {
      const v = values[f.key];
      if (f.secret) {
        if (v === null) credentials[f.key] = null; // explicit clear
        else if (typeof v === 'string' && v !== '') credentials[f.key] = v;
        // blank → omitted → kept (edit) / absent (create)
      } else if (v !== undefined && v !== '') {
        config[f.key] = v;
      } else if (connection && v === '' && connection.config?.[f.key] !== undefined) {
        config[f.key] = null; // emptied a stored non-secret value
      }
    }
    return { credentials, config };
  }

  async function save(andTest) {
    setSaving(true);
    setError('');
    setTestResult(null);
    try {
      const body = { name: name.trim(), mode, ...splitPayload() };
      const saved = connection
        ? await updateConnection(connection.id, body)
        : await createConnection({ integration: integration.id, ...body });
      let final = saved;
      setSavedConnection(saved);
      setSaveCount((n) => n + 1);
      if (andTest) {
        const result = await testConnection(saved.id);
        setTestResult(result);
        final = { ...saved, status: result.status, lastError: result.lastError ?? null, lastTestedAt: new Date().toISOString() };
      }
      onSaved?.(final);
      if (!andTest) onClose();
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to save connection'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center gap-2">
          <span className="text-xl">{integrationIcon(integration?.icon || integration?.id)}</span>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {connection ? `Edit ${connection.name}` : `New ${integration?.name} connection`}
          </h2>
        </div>

        <div className="space-y-4">
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Mode</span>
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
              {['live', 'sandbox'].map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={m === 'live' && liveBlocked}
                  onClick={() => setMode(m)}
                  className={`rounded-md px-3 py-1 text-sm capitalize transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    mode === m
                      ? 'bg-brand-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {!hasLiveActions
                ? `${integration?.name} has no live actions — it always runs in the sandbox.`
                : liveEnabled === false
                  ? 'Live calls are disabled on this server.'
                  : mode === 'live'
                    ? 'Nodes using this connection call the real service.'
                    : 'Nodes using this connection run in the sandbox — nothing is sent.'}
            </p>
          </div>

          {isMcp ? (
            <McpConnectionFields
              values={values}
              onChange={setValues}
              hint={connection?.credentialHints?.authHeader}
              onClear={connection ? (key) => setValues((v) => ({ ...v, [key]: null })) : undefined}
              isEdit={Boolean(connection)}
            />
          ) : fields.length > 0 ? (
            <ToolConfigFields
              title="Credentials"
              schema={fields}
              values={values}
              hints={connection?.credentialHints || {}}
              onChange={setValues}
              onClear={connection ? (key) => setValues((v) => ({ ...v, [key]: null })) : undefined}
              showTemplateNote={false}
            />
          ) : (
            <p className="text-xs text-slate-400">This integration needs no credentials.</p>
          )}

          {connection && (integration?.hasInbound || inboundUrl) && (
            <div className="space-y-1">
              <span className="block text-sm font-medium text-slate-700 dark:text-slate-300">Inbound webhook URL</span>
              {inboundUrl ? (
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={inboundUrl}
                    className="w-full rounded-lg border border-slate-300 bg-slate-50 px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    onFocus={(e) => e.target.select()}
                  />
                  <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => navigator.clipboard?.writeText(inboundUrl)}>
                    Copy
                  </Button>
                </div>
              ) : null}
              <button type="button" onClick={generateInbound} className="text-xs text-brand-600 hover:underline dark:text-brand-400">
                {inboundUrl ? 'Regenerate (the old URL stops working)' : 'Generate inbound URL'}
              </button>
              <p className="text-xs text-slate-400">Paste this into {integration?.name} so its events trigger your workflows.</p>
            </div>
          )}

          {testResult && (
            <p
              className={`rounded-lg px-3 py-2 text-xs ${
                testResult.status === 'ok'
                  ? 'bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300'
                  : 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
              }`}
            >
              {testResult.status === 'ok' ? '✓ Connection works' : `✗ ${testResult.lastError || 'Test failed'}`}
              {testResult.detail ? ` — ${testResult.detail}` : ''}
            </p>
          )}
          {isMcp && savedConnection?.id && (!testResult || testResult.status === 'ok') && (
            <McpToolList key={`${savedConnection.id}:${saveCount}`} connectionId={savedConnection.id} />
          )}
          {isMcp && formError && <p className="text-xs text-slate-400">{formError}</p>}
          <ErrorText>{error}</ErrorText>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              {testResult ? 'Close' : 'Cancel'}
            </Button>
            <Button variant="secondary" disabled={saving || !name.trim() || Boolean(formError)} onClick={() => save(true)}>
              Save &amp; test
            </Button>
            <Button disabled={saving || !name.trim() || Boolean(formError)} onClick={() => save(false)}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
