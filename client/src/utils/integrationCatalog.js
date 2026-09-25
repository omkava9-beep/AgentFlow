/**
 * Pure helpers over the catalogue from `GET /api/integrations` (spec/26), kept
 * out of components so the validator, the canvas node and `check:logic` all
 * read it the same way.
 */

export const CATEGORY_LABELS = {
  builtin: 'Built-in',
  communication: 'Communication',
  developer: 'Developer',
  data: 'Data & Productivity',
  productivity: 'Data & Productivity',
  commerce: 'Commerce & CRM',
  crm: 'Commerce & CRM',
  web: 'Web',
  ai: 'AI',
  other: 'Other',
};

const ICONS = {
  builtin: '🔧',
  slack: '💬',
  discord: '🎮',
  teams: '👥',
  email: '✉️',
  smtp: '✉️',
  twilio: '📱',
  sms: '📱',
  github: '🐙',
  jira: '🧩',
  linear: '📐',
  sheets: '📊',
  'google-sheets': '📊',
  notion: '📓',
  airtable: '🗂️',
  database: '🗄️',
  stripe: '💳',
  hubspot: '🧲',
  http: '🌐',
  webhook: '🪝',
  'outbound-webhook': '🪝',
  rss: '📰',
  ai: '🧠',
  llm: '🧠',
  knowledge: '📚',
  'knowledge-base': '📚',
  mcp: '🔌',
};

/** Emoji for a manifest's `icon` (or id). Unknown icons fall back to the generic tool glyph. */
export function integrationIcon(iconOrId) {
  return ICONS[iconOrId] || '🔧';
}

export const categoryLabel = (category) => CATEGORY_LABELS[category] || category || 'Other';

export function findIntegration(catalog, id) {
  return (catalog || []).find((i) => i.id === id) || null;
}

export function findAction(catalog, integrationId, actionId) {
  const integration = findIntegration(catalog, integrationId);
  return integration?.actions?.find((a) => a.id === actionId) || null;
}

/** `live` in the brief, `liveCapable` in spec/26's list() — accept either. */
export const actionIsLive = (action) => Boolean(action && (action.live ?? action.liveCapable));

export const needsCredentials = (integration) => Boolean(integration) && integration.auth?.type !== 'none';

/**
 * The client's prediction of spec/26 §3's mode rule. The server decides for
 * real at execution time (and records it on the node result); this only drives
 * the "Will run" hint and the canvas badge.
 *
 * `connection` is the resolved connection object when `connectionId` is an id,
 * or undefined when it isn't loaded. Returns 'live' | 'sandbox' | 'unknown'.
 */
export function predictMode({ integration, action, connectionId, connection, liveEnabled }) {
  if (liveEnabled === false) return 'sandbox';
  if (!integration || !action || !actionIsLive(action)) return 'sandbox';
  if (connectionId === 'sandbox') return 'sandbox';
  if (connectionId) {
    if (!connection) return 'unknown';
    return connection.mode === 'live' ? 'live' : 'sandbox';
  }
  return integration.auth?.type === 'none' ? 'live' : 'sandbox';
}

/** Integrations grouped by category label, in catalogue order. */
export function groupByCategory(catalog, filter = '') {
  const q = filter.trim().toLowerCase();
  const groups = new Map();
  for (const integration of catalog || []) {
    if (q && !`${integration.name} ${integration.id} ${integration.description || ''}`.toLowerCase().includes(q)) continue;
    const key = categoryLabel(integration.category);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(integration);
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}

/**
 * Builds a catalogue from phase-2 `GET /api/tools` output, used only while a
 * server without `/api/integrations` is on the other end. Each legacy tool is
 * filed under the integration spec/26 migrates it to.
 */
export function catalogFromLegacyTools(tools = [], legacyTarget) {
  const byId = new Map();
  for (const tool of tools) {
    const { integration, action } = legacyTarget(tool.type);
    if (!byId.has(integration)) {
      byId.set(integration, {
        id: integration,
        name: integration === 'builtin' ? 'Built-in tools' : integration[0].toUpperCase() + integration.slice(1),
        icon: integration,
        category: integration === 'builtin' ? 'builtin' : 'other',
        description: '',
        auth: { type: 'none', fields: [] },
        actions: [],
        triggers: [],
      });
    }
    byId.get(integration).actions.push({
      id: action,
      name: tool.label,
      description: tool.description || '',
      configSchema: tool.configSchema || [],
      live: false,
    });
  }
  return [...byId.values()];
}

/** Token shapes spec/25 warns about when they're pasted into plain params. */
const TOKEN_PATTERNS = [/xoxb-/, /ghp_/, /github_pat_/, /sk_live_/, /sk_test_/, /^Bearer\s+\S+/i];

export function looksLikeSecret(value) {
  return typeof value === 'string' && TOKEN_PATTERNS.some((re) => re.test(value.trim()));
}

/**
 * `json` params may contain `{{input.x}}` placeholders that the server
 * interpolates before parsing, so they're swapped for a neutral literal before
 * the syntax check. Returns an error message or null. Empty is valid.
 */
export function jsonParamError(text) {
  if (text === undefined || text === null || String(text).trim() === '') return null;
  if (typeof text !== 'string') return null;
  try {
    JSON.parse(text.replace(/\{\{[^}]*\}\}/g, '0'));
    return null;
  } catch (err) {
    return `Invalid JSON: ${err.message}`;
  }
}
