/**
 * Client copy of the server's legacy tool mapping (spec/26 §6).
 *
 * Phase-2 tool nodes stored `{ toolType, toolConfig }`; phase 3 stores
 * `{ integration, action, connectionId, params }`. The server migrates saved
 * workflows on boot, but a template, an old tab or a workflow imported
 * mid-migration can still hand the client the old shape, so it's normalised on
 * load too. Keep this table identical to server/src/integrations/legacy.js.
 */
export const LEGACY_TOOL_MAP = {
  'fake-weather': { integration: 'builtin', action: 'fake-weather' },
  calculator: { integration: 'builtin', action: 'calculator' },
  'fake-search': { integration: 'builtin', action: 'fake-search' },
  // The four action tools map to their real integrations, not to `builtin`,
  // so Slack doesn't appear twice in the palette.
  'send-email': { integration: 'email', action: 'send' },
  'slack-message': { integration: 'slack', action: 'post_message' },
  'http-request': { integration: 'http', action: 'request' },
  'database-write': { integration: 'database', action: 'insert' },
};

/** Where a legacy `toolType` lands. Unknown types keep their name under `builtin`. */
export function legacyTarget(toolType) {
  return LEGACY_TOOL_MAP[toolType] || { integration: 'builtin', action: toolType };
}

export const isLegacyToolConfig = (config) => Boolean(config) && 'toolType' in config && !config.integration;

/**
 * Returns the phase-3 shape. `integration` wins when both are present, and the
 * legacy keys are dropped either way so they can't be saved back.
 */
export function normalizeToolConfig(config = {}) {
  const { toolType, toolConfig, ...rest } = config;
  if (rest.integration) {
    return { ...rest, connectionId: rest.connectionId ?? null, params: rest.params || {} };
  }
  if (toolType === undefined && toolConfig === undefined) {
    return {
      ...rest,
      integration: rest.integration ?? '',
      action: rest.action ?? '',
      connectionId: rest.connectionId ?? null,
      params: rest.params || {},
    };
  }
  // An unset legacy type ('' from the phase-2 default node) stays unset.
  const target = toolType ? legacyTarget(toolType) : { integration: '', action: '' };
  return { ...rest, ...target, connectionId: rest.connectionId ?? null, params: toolConfig || rest.params || {} };
}

/** Normalises every tool node in a node list; other node types pass through untouched. */
export function normalizeToolNodes(nodes = []) {
  return nodes.map((n) =>
    n.type === 'tool' && n.data?.config
      ? { ...n, data: { ...n.data, config: normalizeToolConfig(n.data.config) } }
      : n,
  );
}
