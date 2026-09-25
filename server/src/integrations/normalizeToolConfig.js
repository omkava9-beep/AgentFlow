/**
 * Phase-2 tool nodes stored `{ toolType, toolConfig }`. Phase 3 stores
 * `{ integration, action, connectionId, params }` (spec/26 §5–6). This maps the
 * old shape onto the new one, and is applied everywhere a legacy node could
 * still arrive: the boot migration, workflow/template saves, and the engine
 * itself — so no legacy shape ever reaches an action.
 *
 * The four phase-2 action tools map to their *real* integrations rather than to
 * `builtin`, otherwise Slack would appear twice in the palette.
 */
export const LEGACY_TOOL_MAP = Object.freeze({
  'fake-weather': ['builtin', 'fake-weather'],
  calculator: ['builtin', 'calculator'],
  'fake-search': ['builtin', 'fake-search'],
  'send-email': ['email', 'send'],
  'slack-message': ['slack', 'post_message'],
  'http-request': ['http', 'request'],
  'database-write': ['database', 'insert'],
});

export function isLegacyToolConfig(config) {
  return Boolean(config) && typeof config === 'object' && ('toolType' in config || 'toolConfig' in config);
}

/**
 * Returns the same object when there's nothing to do, so callers can cheaply
 * tell whether a node changed. Unknown tool types become `builtin.<toolType>`:
 * preserved (and surfaced as "unknown"), never dropped.
 */
export function normalizeToolConfig(config) {
  if (!isLegacyToolConfig(config)) return config;
  const { toolType, toolConfig, ...rest } = config;

  // A node that somehow carries both shapes: the new one wins.
  if (rest.integration) return rest;

  if (!toolType) {
    return { ...rest, integration: '', action: '', connectionId: rest.connectionId ?? null, params: rest.params ?? { ...(toolConfig || {}) } };
  }

  const [integration, action] = LEGACY_TOOL_MAP[toolType] || ['builtin', toolType];
  const out = { ...rest, integration, action, connectionId: null, params: { ...(toolConfig || {}) } };
  // A phase-2 HTTP node was simulated; with no connection it now runs live (C3).
  // The Builder shows a one-time notice for nodes carrying this flag.
  if (integration === 'http') out.migratedFromMock = true;
  return out;
}

/** Normalizes one graph node; non-tool nodes are returned untouched. */
export function normalizeNode(node) {
  if (!node || node.type !== 'tool') return node;
  const config = node.data?.config;
  const next = normalizeToolConfig(config);
  if (next === config) return node;
  return { ...node, data: { ...(node.data || {}), config: next } };
}

/** `{ nodes, changed }` — `changed` counts the tool nodes that were rewritten. */
export function normalizeNodes(nodes = []) {
  let changed = 0;
  const out = (nodes || []).map((node) => {
    const next = normalizeNode(node);
    if (next !== node) changed += 1;
    return next;
  });
  return { nodes: out, changed };
}
