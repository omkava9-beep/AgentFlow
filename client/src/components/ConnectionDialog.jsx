import { useMemo, useState } from 'react';
import { createConnection, updateConnection, testConnection, createInboundToken } from '../api/connections';
import { apiErrorMessage } from '../api/client';
import { actionIsLive } from '../utils/integrationCatalog';
import IntegrationLogo from './ui/IntegrationLogo';
import { useIntegrationStore } from '../store/integrationStore';
import ToolConfigFields from './ToolConfigFields';
import McpConnectionFields from './McpConnectionFields';
import { mcpPayload, mcpFormError } from '../utils/mcpConnection';
import McpToolList from './McpToolList';
import { CircleAlert, CircleCheck, FlaskConical, PlugZap, Radio, ShieldCheck } from 'lucide-react';
import { Button, Dialog, Field, Input, Segmented, CopyButton } from './ui/index';

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
  const [testing, setTesting] = useState(false);
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

  const modeHelp = !hasLiveActions
    ? `${integration?.name} has no live actions — it always runs in the sandbox.`
    : liveEnabled === false
      ? 'Live calls are disabled on this server, so this connection runs in the sandbox for now.'
      : mode === 'live'
        ? 'Nodes using this connection call the real service.'
        : 'Nodes using this connection run in the sandbox — nothing is sent anywhere.';
  const disabled = saving || !name.trim() || Boolean(formError);

  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!saving}
      size="md"
      testId="connection-dialog"
      title={connection ? `Edit ${connection.name}` : `New ${integration?.name} connection`}
      description={integration?.description}
      icon={() => <IntegrationLogo id={integration?.id} name={integration?.name} size="sm" />}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving} className="mr-auto">
            {testResult ? 'Close' : 'Cancel'}
          </Button>
          <Button variant="secondary" icon={PlugZap} disabled={disabled} loading={saving && testing} onClick={() => { setTesting(true); save(true); }}>
            Save &amp; test
          </Button>
          <Button disabled={disabled} loading={saving && !testing} onClick={() => { setTesting(false); save(false); }}>
            Save
          </Button>
        </>
      )}
    >
      <div className="space-y-5">
        <Field label="Name" htmlFor="connection-name">
          <Input id="connection-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label="Mode" help={modeHelp}>
          <div>
            <Segmented
              aria-label="Mode"
              size="md"
              value={mode}
              onChange={setMode}
              items={[
                { value: 'live', label: 'Live', icon: Radio, disabled: liveBlocked },
                { value: 'sandbox', label: 'Sandbox', icon: FlaskConical },
              ]}
            />
          </div>
        </Field>

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
          <p className="flex items-center gap-2 rounded-card border border-default bg-bg-subtle px-3 py-2 text-sm text-muted">
            <ShieldCheck className="h-4 w-4 text-subtle" aria-hidden="true" />
            This integration needs no credentials.
          </p>
        )}

        {connection && (integration?.hasInbound || inboundUrl) && (
          <Field
            label="Inbound webhook URL"
            help={`Paste this into ${integration?.name} so its events trigger your workflows.`}
            trailing={(
              <Button variant="link" size="sm" onClick={generateInbound}>
                {inboundUrl ? 'Regenerate' : 'Generate URL'}
              </Button>
            )}
          >
            {inboundUrl ? (
              <div className="flex gap-2">
                <Input readOnly value={inboundUrl} className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label="Inbound webhook URL" />
                <CopyButton value={inboundUrl} label="Copy" />
              </div>
            ) : (
              <p className="text-sm text-subtle">No inbound URL yet.</p>
            )}
          </Field>
        )}

        {testResult && (
          <div
            role="status"
            className={`flex items-start gap-2 rounded-card border px-3 py-2 text-sm ${
              testResult.status === 'ok'
                ? 'border-success/25 bg-success-subtle text-success-subtle-fg'
                : 'border-danger/25 bg-danger-subtle text-danger-subtle-fg'
            }`}
          >
            {testResult.status === 'ok'
              ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
            <span>
              {testResult.status === 'ok' ? 'Connection works' : testResult.lastError || 'Test failed'}
              {testResult.detail ? ` — ${testResult.detail}` : ''}
            </span>
          </div>
        )}
        {isMcp && savedConnection?.id && (!testResult || testResult.status === 'ok') && (
          <McpToolList key={`${savedConnection.id}:${saveCount}`} connectionId={savedConnection.id} />
        )}
        {isMcp && formError && <p className="text-xs text-subtle">{formError}</p>}
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}
