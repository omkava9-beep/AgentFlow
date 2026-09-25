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
  integrationIcon,
  predictMode,
  actionIsLive,
} from '../utils/integrationCatalog';
import ConnectionPicker from './ConnectionPicker';
import ToolConfigFields from './ToolConfigFields';
import MockBehaviorFields from './MockBehaviorFields';
import { Select, TextField } from './ui';

/**
 * A tool node's integration → action → connection → params form (spec/26 §8),
 * rendered entirely from the catalogue. Changing the integration or the action
 * clears `params` (spec/21's "no orphaned keys"); a stored integration or
 * action the catalogue no longer has stays selectable, so opening the node
 * can't quietly wipe its config.
 */
export default function ToolNodeFields({ node, set, readOnly }) {
  const catalog = useIntegrationStore((s) => s.catalog);
  const defaults = useIntegrationStore((s) => s.defaults);
  const liveEnabled = useIntegrationStore((s) => s.liveEnabled);
  const connections = useIntegrationStore((s) => s.connections);
  const loadConnections = useIntegrationStore((s) => s.loadConnections);
  const workspaceId = useWorkspaceStore((s) => s.current?.id);
  const [filter, setFilter] = useState('');
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
  const groups = groupByCategory(catalog, filter);

  // The one-time "now makes real requests" notice (spec/26 §6) clears on edit.
  const edit = (patch) => set(config.migratedFromMock ? { ...patch, migratedFromMock: false } : patch);

  function changeIntegration(id) {
    edit({ integration: id, action: '', connectionId: null, params: {} });
  }

  function changeAction(id) {
    edit({ action: id, params: {} });
  }

  if (!catalog) {
    return <p className="text-xs text-slate-400">Loading integrations…</p>;
  }

  return (
    <>
      {config.migratedFromMock && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
          This node now makes <strong>real HTTP requests</strong>. It was a simulated tool before phase 3. Pick
          &ldquo;Sandbox (no account)&rdquo; below to keep it simulated.
        </p>
      )}

      <div className="space-y-2">
        <TextField
          label="Integration"
          placeholder="Search integrations…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <Select
          aria-label="Integration"
          value={config.integration || ''}
          onChange={(e) => changeIntegration(e.target.value)}
        >
          <option value="">Select an integration…</option>
          {groups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.items.map((i) => (
                <option key={i.id} value={i.id}>
                  {integrationIcon(i.icon || i.id)} {i.name}
                  {(i.actions || []).some(actionIsLive) || i.liveCapable ? ' · live-capable' : ''}
                </option>
              ))}
            </optgroup>
          ))}
          {/* Kept visible even when filtered out, so the select never shows a
              value that isn't in its option list. */}
          {integration && !groups.some((g) => g.items.includes(integration)) && (
            <option value={integration.id}>
              {integrationIcon(integration.icon || integration.id)} {integration.name}
            </option>
          )}
          {unknownIntegration && <option value={config.integration}>{config.integration} (unknown)</option>}
        </Select>
        {unknownIntegration && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Unknown integration &ldquo;{config.integration}&rdquo; — it isn&rsquo;t in the catalogue. Pick a replacement,
            or leave it and this node will fail at run time.
          </p>
        )}
        {integration?.description && <p className="text-xs text-slate-400">{integration.description}</p>}
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
            <p className="text-xs text-slate-400">Pick a connection to see the tools its server offers.</p>
          ) : dynamicActions === null ? (
            <p className="text-xs text-slate-400">Discovering tools…</p>
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
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Tool &ldquo;{config.action}&rdquo; is no longer offered by {connection?.name || 'this server'} — this node will
              fail until you pick another.
            </p>
          )}
          {action && (
            <div className="flex flex-wrap items-center gap-1.5">
              <ToolBadges annotations={action.annotations} />
            </div>
          )}
          {action?.description && <p className="text-xs text-slate-400">{action.description}</p>}
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
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Unknown action &ldquo;{config.action}&rdquo; for {integration.name}.
            </p>
          )}
          {action?.description && <p className="text-xs text-slate-400">{action.description}</p>}

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

      {action && (
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
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
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

