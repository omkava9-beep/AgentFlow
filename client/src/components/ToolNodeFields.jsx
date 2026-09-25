import { useEffect, useMemo, useState } from 'react';
import { useIntegrationStore, connectionById } from '../store/integrationStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { listIntegrationActions } from '../api/integrations';
import { listMcpTools } from '../api/mcp';
import { toolToAction } from '../utils/mcpSchema';
import { ToolBadges } from './McpToolList';
import {
  findIntegration,
  groupByCategory,
  predictMode,
  actionIsLive,
} from '../utils/integrationCatalog';
import ConnectionPicker from './ConnectionPicker';
import ToolConfigFields from './ToolConfigFields';
import MockBehaviorFields from './MockBehaviorFields';
import { Select } from './ui';
import { Field } from './ui/Form';
import { Combobox } from './ui/Combobox';
import IntegrationLogo from './ui/IntegrationLogo';

// One stable icon component per integration, for the Combobox's `icon` slot
// (a fresh component per render would remount the logo on every keystroke).
const LOGOS = new Map();
function logoFor(integration) {
  if (!LOGOS.has(integration.id)) {
    const Logo = ({ className = '' }) => <IntegrationLogo id={integration.id} name={integration.name} size="xs" className={className} />;
    Logo.displayName = `Logo(${integration.id})`;
    LOGOS.set(integration.id, Logo);
  }
  return LOGOS.get(integration.id);
}

/**
 * A tool node's integration → action → connection → params form (spec/26 §8),
 * rendered entirely from the catalogue. Changing the integration or the action
 * clears `params` (spec/21's "no orphaned keys"); a stored integration or
 * action the catalogue no longer has stays selectable, so opening the node
 * can't quietly wipe its config.
 */
export default function ToolNodeFields({ node, set, readOnly, hideBehavior = false }) {
  const catalog = useIntegrationStore((s) => s.catalog);
  const defaults = useIntegrationStore((s) => s.defaults);
  const liveEnabled = useIntegrationStore((s) => s.liveEnabled);
  const connections = useIntegrationStore((s) => s.connections);
  const loadConnections = useIntegrationStore((s) => s.loadConnections);
  const workspaceId = useWorkspaceStore((s) => s.current?.id);
  const [dynamicActions, setDynamicActions] = useState(null);

  const config = node.data.config;
  const integration = findIntegration(catalog, config.integration);
  const unknownIntegration = Boolean(config.integration) && catalog && !integration;

  useEffect(() => {
    if (workspaceId) loadConnections(workspaceId);
  }, [workspaceId, loadConnections]);

  // Integrations like MCP discover their actions per connection (spec/37).
  const realConnectionId = config.connectionId && config.connectionId !== 'sandbox' ? config.connectionId : null;
  useEffect(() => {
    setDynamicActions(null);
    if (!integration?.dynamicActions || !realConnectionId) return;
    let cancelled = false;
    // MCP tools come with annotations and the raw inputSchema, which the JSON
    // editors validate against; other dynamic integrations use the generic route.
    const load =
      integration.id === 'mcp'
        ? listMcpTools(realConnectionId).then((data) => data.tools.map(toolToAction))
        : listIntegrationActions(integration.id, realConnectionId).then((data) => data.actions || data || []);
    load
      .then((list) => !cancelled && setDynamicActions(list))
      .catch(() => !cancelled && setDynamicActions([]));
    return () => {
      cancelled = true;
    };
  }, [integration?.id, integration?.dynamicActions, realConnectionId]);

  const actions = useMemo(() => {
    const base = integration?.actions || [];
    if (!dynamicActions?.length) return base;
    const ids = new Set(base.map((a) => a.id));
    return [...base, ...dynamicActions.filter((a) => !ids.has(a.id))];
  }, [integration, dynamicActions]);
  const action = actions.find((a) => a.id === config.action) || null;
  const unknownAction = Boolean(config.action) && integration && !action && !(integration.dynamicActions && !dynamicActions);

  const connection = connectionById(connections, realConnectionId);
  const isDynamic = Boolean(integration?.dynamicActions);
  // "no longer offered" only makes sense once this connection's list has loaded.
  const toolGone = isDynamic && Boolean(config.action) && Array.isArray(dynamicActions) && !action;
  const mode = predictMode({ integration, action, connectionId: config.connectionId, connection, liveEnabled });
  // Grouped by category; the Combobox does the searching.
  const groups = groupByCategory(catalog, '');
  const integrationOptions = groups.map((group) => ({
    label: group.label,
    options: group.items.map((i) => {
      const live = (i.actions || []).some(actionIsLive) || i.liveCapable;
      const count = (i.actions || []).length;
      return {
        value: i.id,
        label: i.name,
        icon: logoFor(i),
        description: [live ? 'Live-capable' : 'Sandbox', i.dynamicActions ? 'tools discovered per connection' : `${count} action${count === 1 ? '' : 's'}`].join(' · '),
        keywords: `${i.id} ${i.category || ''} ${i.description || ''}`,
      };
    }),
  }));
  // Kept offered even when the catalogue no longer has it, so the picker never
  // shows a value that isn't in its list.
  if (unknownIntegration) {
    integrationOptions.push({ label: 'Unknown', options: [{ value: config.integration, label: `${config.integration} (unknown)` }] });
  }

  // The one-time "now makes real requests" notice (spec/26 §6) clears on edit.
  const edit = (patch) => set(config.migratedFromMock ? { ...patch, migratedFromMock: false } : patch);

  function changeIntegration(id) {
    edit({ integration: id, action: '', connectionId: null, params: {} });
  }

  function changeAction(id) {
    edit({ action: id, params: {} });
  }

  if (!catalog) {
    return <p className="text-xs text-subtle">Loading integrations…</p>;
  }

  return (
    <>
      {config.migratedFromMock && (
        <p className="rounded-lg bg-warning-subtle px-3 py-2 text-xs text-warning-subtle-fg">
          This node now makes <strong>real HTTP requests</strong>. It was a simulated tool before phase 3. Pick
          &ldquo;Sandbox (no account)&rdquo; below to keep it simulated.
        </p>
      )}

      <div className="space-y-2">
        <Field label="Integration">
          <Combobox
            aria-label="Integration"
            data-testid="integration-picker"
            value={config.integration || ''}
            onChange={(id) => id && id !== config.integration && changeIntegration(id)}
            options={integrationOptions}
            placeholder="Select an integration…"
            searchPlaceholder="Search integrations…"
            emptyText="No integration matches."
            disabled={readOnly}
            contentClassName="w-[320px]"
          />
        </Field>
        {unknownIntegration && (
          <p className="text-xs text-warning">
            Unknown integration &ldquo;{config.integration}&rdquo; — it isn&rsquo;t in the catalogue. Pick a replacement,
            or leave it and this node will fail at run time.
          </p>
        )}
        {integration?.description && <p className="text-xs text-subtle">{integration.description}</p>}
      </div>

      {integration && isDynamic && (
        <>
          <ConnectionPicker
            integration={integration}
            value={config.connectionId ?? null}
            readOnly={readOnly}
            onChange={(connectionId) => edit({ connectionId, action: '', params: {} })}
          />
          {!realConnectionId ? (
            <p className="text-xs text-subtle">Pick a connection to see the tools its server offers.</p>
          ) : dynamicActions === null ? (
            <p className="text-xs text-subtle">Discovering tools…</p>
          ) : (
            <Select label="Tool" value={config.action || ''} onChange={(e) => changeAction(e.target.value)}>
              <option value="">{dynamicActions.length ? 'Select a tool…' : 'This server offers no tools'}</option>
              {dynamicActions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.annotations?.readOnlyHint === true ? ' · read-only' : ' · side effect'}
                </option>
              ))}
              {toolGone && <option value={config.action}>{config.action} (no longer offered)</option>}
            </Select>
          )}
          {toolGone && (
            <p className="text-xs text-warning">
              Tool &ldquo;{config.action}&rdquo; is no longer offered by {connection?.name || 'this server'} — this node will
              fail until you pick another.
            </p>
          )}
          {action && (
            <div className="flex flex-wrap items-center gap-1.5">
              <ToolBadges annotations={action.annotations} />
            </div>
          )}
          {action?.description && <p className="text-xs text-subtle">{action.description}</p>}
          {action && <ModeHint mode={mode} connection={connection} liveEnabled={liveEnabled} action={action} />}
        </>
      )}

      {integration && !isDynamic && (
        <>
          <Select label="Action" value={config.action || ''} onChange={(e) => changeAction(e.target.value)}>
            <option value="">Select an action…</option>
            {actions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {actionIsLive(a) ? '' : ' (sandbox only)'}
              </option>
            ))}
            {unknownAction && <option value={config.action}>{config.action} (unknown)</option>}
          </Select>
          {unknownAction && (
            <p className="text-xs text-warning">
              Unknown action &ldquo;{config.action}&rdquo; for {integration.name}.
            </p>
          )}
          {action?.description && <p className="text-xs text-subtle">{action.description}</p>}

          <ConnectionPicker
            integration={integration}
            value={config.connectionId ?? null}
            readOnly={readOnly}
            onChange={(connectionId) => edit({ connectionId })}
          />

          {action && <ModeHint mode={mode} connection={connection} liveEnabled={liveEnabled} action={action} />}
        </>
      )}

      {action && (
        <ToolConfigFields
          schema={action.configSchema}
          values={config.params || {}}
          onChange={(params) => edit({ params })}
        />
      )}

      {/* The inspector shows these under its Advanced tab instead (hideBehavior). */}
      {action && !hideBehavior && (
        <MockBehaviorFields
          overrides={config.mockOverrides || {}}
          defaults={defaults}
          mode={mode}
          onChange={(mockOverrides) => edit({ mockOverrides })}
        />
      )}
    </>
  );
}

function ModeHint({ mode, connection, liveEnabled, action }) {
  const tone =
    mode === 'live'
      ? 'bg-success-subtle text-success-subtle-fg  '
      : 'bg-bg-subtle text-muted  ';
  let text;
  if (liveEnabled === false) text = 'Runs in sandbox — live calls are disabled on this server.';
  else if (!actionIsLive(action)) text = 'Runs in sandbox — this action has no live adapter.';
  else if (mode === 'live') text = connection ? `Will run live via ${connection.name}.` : 'Will run live — makes a real request.';
  else if (mode === 'unknown') text = 'Mode depends on the selected connection.';
  else text = connection ? `Runs in sandbox — ${connection.name} is in sandbox mode.` : 'Runs in sandbox (no live connection).';

  return (
    <p className={`rounded-lg px-3 py-2 text-xs ${tone}`}>
      <span className="font-semibold uppercase tracking-wide">
        {mode === 'live' ? 'Live' : mode === 'unknown' ? 'Checking' : 'Sandbox'}
      </span>{' '}
      · {text}
      {liveEnabled === undefined && mode === 'live' && (
        <span className="block text-[11px] opacity-75">The server can still force sandbox mode.</span>
      )}
    </p>
  );
}

