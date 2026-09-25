import { INTEGRATIONS } from './manifests/index.js';
import { normalizeToolConfig } from './normalizeToolConfig.js';
import { decideMode } from './mode.js';
import { prepareParams, runAction } from './defineAction.js';
import { createSandboxStore } from './sandboxStore.js';
import { PermanentFailure } from '../queue/errors.js';
import { safeRequest } from '../net/safeRequest.js';
import { buildRedactor } from '../secrets/redact.js';
import { toolCache, toolCacheKey } from '../cache/TTLCache.js';
import { integrationsConfig } from '../config/integrations.js';

const byId = new Map();
for (const manifest of INTEGRATIONS) {
  if (byId.has(manifest.id)) throw new Error(`integration "${manifest.id}" is registered twice`);
  byId.set(manifest.id, manifest);
}

/** The virtual connection behind `connectionId: 'sandbox'` (spec/25 §2). */
const SANDBOX_CONNECTION = Object.freeze({ id: 'sandbox', name: 'Sandbox', mode: 'sandbox', credentials: {}, config: {} });

// connectionService (spec/25) and usage (spec/33) are loaded lazily: the engine
// shouldn't fail to import just because a node never needs either.
let connectionModule;
async function resolveConnection(workspaceId, connectionId, integration) {
  if (connectionId === null || connectionId === undefined || connectionId === '') return null;
  if (connectionId === 'sandbox') return SANDBOX_CONNECTION;
  connectionModule ??= import('../services/connectionService.js');
  const { resolveConnection: resolve } = await connectionModule;
  return resolve(workspaceId, connectionId, integration);
}

let usageModule;
function recordUsage(workspaceId, deltas) {
  if (!workspaceId) return;
  usageModule ??= import('../services/usage.js').catch(() => null);
  usageModule
    .then((mod) => mod?.recordUsage?.(workspaceId, deltas))
    .catch(() => {}); // metering must never fail a node
}

/** Every string credential value, for the per-execution redactor (spec/25 §4). */
export function secretValuesOf(connection) {
  const out = [];
  const walk = (value) => {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(connection?.credentials);
  return out;
}

function clientAction(action) {
  return {
    id: action.id,
    name: action.name,
    description: action.description || '',
    configSchema: action.configSchema,
    outputSample: action.outputSample,
    // A function-valued `cacheable` (http's cacheGet) depends on params.
    cacheable: action.cacheable === true || typeof action.cacheable === 'function',
    sideEffect: action.sideEffect,
    liveCapable: typeof action.live === 'function',
  };
}

function clientManifest(manifest) {
  return {
    id: manifest.id,
    name: manifest.name,
    icon: manifest.icon,
    category: manifest.category,
    description: manifest.description,
    auth: manifest.auth,
    liveCapable: typeof manifest.dynamicActions === 'function' || manifest.actions.some((a) => typeof a.live === 'function'),
    actions: manifest.actions.map(clientAction),
    triggers: (manifest.triggers || []).map(({ id, name, description, samplePayload }) => ({ id, name, description: description || '', samplePayload: samplePayload ?? null })),
    hasInbound: Boolean(manifest.inbound),
    hasTest: typeof manifest.test === 'function',
    dynamicActions: typeof manifest.dynamicActions === 'function',
  };
}

function isCacheable(action, params, mockOverrides) {
  if (action.sideEffect) return false;
  // spec/17: a node with failure injection dialed up must be allowed to fail,
  // which a cache hit would bypass.
  if ((Number(mockOverrides?.failureRate) || 0) > 0) return false;
  return typeof action.cacheable === 'function' ? Boolean(action.cacheable(params)) : action.cacheable !== false;
}

export const IntegrationRegistry = {
  /** Client-facing catalogue, no functions. */
  list() {
    return INTEGRATIONS.map(clientManifest);
  },

  /** One manifest in client shape, or null. */
  describe(id) {
    const manifest = byId.get(id);
    return manifest ? clientManifest(manifest) : null;
  },

  /** The raw manifest (with implementations), or null. */
  get(id) {
    return byId.get(id) || null;
  },

  getAction(integration, action) {
    return byId.get(integration)?.actions.find((a) => a.id === action) || null;
  },

  /** Static actions plus any the connection exposes dynamically (spec/37). */
  async actionsFor(id, { workspaceId, connectionId } = {}) {
    const manifest = byId.get(id);
    if (!manifest) return null;
    const actions = manifest.actions.map(clientAction);
    if (typeof manifest.dynamicActions === 'function') {
      const connection = await resolveConnection(workspaceId, connectionId, id);
      const extra = await manifest.dynamicActions({ connection, workspaceId });
      actions.push(...(extra || []).map((a) => clientAction({ configSchema: [], ...a })));
    }
    return actions;
  },

  /** For the connections service (spec/25 test action). */
  resolveConnection,

  /**
   * Runs the manifest's optional `test(ctx)` against an already-resolved
   * connection (spec/25 "Test connection"). → `{ ok, message }`. Whatever the
   * test throws becomes `ok: false`, with the connection's secrets scrubbed
   * from the message.
   */
  async testConnection(integrationId, { connection, workspaceId } = {}) {
    const manifest = byId.get(integrationId);
    if (!manifest) return { ok: false, message: `Unknown integration: ${integrationId}` };
    if (typeof manifest.test !== 'function') return { ok: true, message: 'No connection test for this integration' };
    const redactor = buildRedactor(secretValuesOf(connection));
    const logs = [];
    try {
      const result = await manifest.test({
        connection, workspaceId, params: {}, input: null, logs,
        sandbox: createSandboxStore({ workspaceId, integration: integrationId, runId: null }),
        http: (options) => safeRequest(options),
      });
      const ok = result?.ok !== false;
      return { ok, message: redactor(String(result?.message || result?.detail || (ok ? 'Connection OK' : 'Connection test failed'))) };
    } catch (err) {
      return { ok: false, message: redactor(String(err?.message || err)) };
    }
  },

  /**
   * The engine's single entry point for tool nodes. Returns
   * `{ output, logs, cached, mode, integration, action }`. Every log line,
   * output and error message is redacted before it leaves here, so neither the
   * engine, the socket nor the cache ever sees a credential.
   */
  async run({ node, config: rawConfig, input, context = {} }) {
    const config = normalizeToolConfig(rawConfig ?? node?.data?.config ?? {}) || {};
    const { integration, action: actionId, connectionId = null, mockOverrides } = config;
    const { workspaceId, runId, workflowId } = context;
    const identity = { integration: integration || null, action: actionId || null };

    if (!integration || !actionId) {
      throw Object.assign(new PermanentFailure('Tool node has no integration or action selected'), identity);
    }
    const manifest = byId.get(integration);
    let action = manifest?.actions.find((a) => a.id === actionId);
    let connection;
    // Dynamic actions (MCP tools, spec/37) exist per connection, so the
    // connection is resolved first and the manifest looks the action up.
    if (!action && typeof manifest?.resolveAction === 'function') {
      connection = await resolveConnection(workspaceId, connectionId, integration);
      try {
        action = await manifest.resolveAction({ actionId, connection, workspaceId });
      } catch (err) {
        throw Object.assign(err, identity);
      }
    }
    if (!action) throw Object.assign(new PermanentFailure(`Unknown action: ${integration}.${actionId}`), identity);

    if (connection === undefined) connection = await resolveConnection(workspaceId, connectionId, integration);
    // An action may refine the mode rule (spec/37 §4: sandboxSafe MCP servers).
    const mode = typeof action.decideMode === 'function'
      ? action.decideMode({ connection, liveEnabled: integrationsConfig.live })
      : decideMode({ manifest, action, connection });
    const redactor = buildRedactor(secretValuesOf(connection));
    const logs = [];

    try {
      const params = prepareParams(action, config.params, input, logs);
      const cacheable = isCacheable(action, params, mockOverrides);
      const key = cacheable
        ? toolCacheKey({ workspaceId, integration, action: actionId, connectionId, mode, params: config.params, input })
        : null;

      if (cacheable) {
        const hit = toolCache.get(key);
        if (hit !== undefined) {
          recordUsage(workspaceId, { cacheHits: 1 });
          return { ...hit, cached: true };
        }
      }

      const ctx = {
        params,
        input,
        connection,
        workspaceId,
        runId,
        workflowId,
        logs,
        sandbox: createSandboxStore({ workspaceId, integration, runId }),
        http: (options) => safeRequest(options),
        // Cancels in-flight work that supports it (MCP sends notifications/cancelled).
        signal: context.signal,
      };
      const output = await runAction({ manifest, action, mode, ctx, mockOverrides });
      // AI presets report which agent provider actually ran them ('mock' |
      // 'llm') - spec/27's one exception to the live/sandbox pair.
      const reportedMode = ctx.reportMode || mode;

      const result = { output: redactor(output), logs: redactor(logs), cached: false, mode: reportedMode, ...identity };
      if (cacheable) {
        toolCache.set(key, result);
        recordUsage(workspaceId, { cacheMisses: 1 });
      }
      recordUsage(workspaceId, mode === 'live' ? { integrationCallsLive: 1 } : { integrationCallsSandbox: 1 });
      return result;
    } catch (err) {
      // The engine logs err.message and the queue logs it per retry, so the
      // message itself must be clean. Mutated in place to keep the error's
      // class and retry flags (permanent, retryAfterMs) intact.
      if (err && typeof err.message === 'string') err.message = redactor(err.message);
      err.logs = redactor(logs);
      Object.assign(err, { mode }, identity);
      throw err;
    }
  },

  /** What the server will actually do with live calls, for the client banner. */
  get liveEnabled() {
    return integrationsConfig.live;
  },
};
