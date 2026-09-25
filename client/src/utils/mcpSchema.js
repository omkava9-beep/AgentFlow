/**
 * Pure helpers for spec/37's MCP tools on the client: the JSON Schema → form
 * mapping, the light sub-schema check behind the JSON editors, and turning a
 * discovered tool into the same action shape every other integration uses.
 *
 * The server does the same mapping and is authoritative (it validates again at
 * run time). The client repeats it only so a tool listed with nothing but an
 * `inputSchema` still renders, and so the editors can show errors inline.
 */

/**
 * The key the server uses for the whole-argument JSON editor (spec/37 §3,
 * server/src/mcp/schemaToConfig.js). Kept identical so a node configured on
 * either side round-trips.
 */
export const WHOLE_ARGS_KEY = '__args';
/** Past this many properties the whole argument object is one JSON editor. */
export const MAX_FORM_PROPERTIES = 25;
/** Agents carry every tool definition on every step, so the list is capped. */
export const MAX_AGENT_TOOLS = 20;

const COMPLEX_KEYWORDS = ['$ref', 'oneOf', 'anyOf', 'allOf'];

function isComplex(prop) {
  if (!prop || typeof prop !== 'object') return true;
  if (COMPLEX_KEYWORDS.some((k) => k in prop)) return true;
  const type = Array.isArray(prop.type) ? prop.type.find((t) => t !== 'null') : prop.type;
  return type === 'object' || type === 'array' || (!type && !prop.enum);
}

function fieldFor(key, prop, required) {
  const base = {
    key,
    label: prop.title || key,
    description: prop.description,
    required: required.includes(key),
    ...(prop.default !== undefined && { default: prop.default }),
  };
  if (isComplex(prop)) return { ...base, type: 'json', schema: prop };
  if (Array.isArray(prop.enum) && prop.enum.every((v) => typeof v === 'string')) {
    return { ...base, type: 'select', options: prop.enum.map((v) => ({ value: v, label: v })) };
  }
  const type = Array.isArray(prop.type) ? prop.type.find((t) => t !== 'null') : prop.type;
  if (type === 'number' || type === 'integer') {
    return { ...base, type: 'number', ...(prop.minimum !== undefined && { min: prop.minimum }), ...(prop.maximum !== undefined && { max: prop.maximum }) };
  }
  if (type === 'boolean') return { ...base, type: 'boolean' };
  const long = (prop.maxLength ?? 0) > 200 || /\b(body|content)\b/i.test(prop.description || '');
  const hint = { date: 'YYYY-MM-DD', email: 'name@example.com', uri: 'https://…' }[prop.format];
  return { ...base, type: long ? 'textarea' : 'text', ...(hint && { placeholder: hint }) };
}

/**
 * spec/37 §3's table. Returns `{ configSchema, jsonEditor }`: `jsonEditor: true`
 * means the whole argument object is one JSON field under `__args` (non-object
 * schemas, top-level $ref/oneOf/anyOf/allOf, or more than 25 properties).
 */
export function mapInputSchema(inputSchema) {
  const schema = inputSchema && typeof inputSchema === 'object' ? inputSchema : { type: 'object', properties: {} };
  const properties = schema.properties || {};
  const keys = Object.keys(properties);
  if ((schema.type && schema.type !== 'object') || keys.length > MAX_FORM_PROPERTIES || COMPLEX_KEYWORDS.some((k) => k in schema)) {
    return {
      jsonEditor: true,
      configSchema: [{ key: WHOLE_ARGS_KEY, label: 'Arguments (JSON)', type: 'json', required: false, placeholder: '{ … }', schema }],
    };
  }
  const required = Array.isArray(schema.required) ? schema.required : [];
  return { configSchema: keys.map((k) => fieldFor(k, properties[k], required)), jsonEditor: false };
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function typeMatches(expected, value) {
  const actual = typeOf(value);
  const list = Array.isArray(expected) ? expected : [expected];
  return list.some((t) => t === actual || (t === 'number' && actual === 'integer'));
}

/**
 * A deliberately small JSON Schema check — type, required, enum, properties,
 * items and oneOf/anyOf — enough to catch the mistakes people make in an
 * editor. `$ref` and anything fancier is left to the server. Returns the first
 * problem as a message with a dotted path, or null.
 */
export function schemaError(value, schema, path = '') {
  if (!schema || typeof schema !== 'object') return null;
  const at = path || 'value';
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
    const options = schema.oneOf || schema.anyOf;
    if (!options.some((s) => !schemaError(value, s, path))) return `${at} doesn't match any allowed shape`;
  }
  if (schema.type && !typeMatches(schema.type, value)) {
    return `${at} should be ${Array.isArray(schema.type) ? schema.type.join(' or ') : schema.type}, got ${typeOf(value)}`;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((v) => JSON.stringify(v) === JSON.stringify(value))) {
    return `${at} must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`;
  }
  if (typeOf(value) === 'object') {
    for (const key of schema.required || []) {
      if (value[key] === undefined) return `${path ? `${path}.` : ''}${key} is required`;
    }
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (value[key] === undefined) continue;
      const err = schemaError(value[key], sub, path ? `${path}.${key}` : key);
      if (err) return err;
    }
  }
  if (typeOf(value) === 'array' && schema.items && typeof schema.items === 'object') {
    for (let i = 0; i < value.length; i++) {
      const err = schemaError(value[i], schema.items, `${at}[${i}]`);
      if (err) return err;
    }
  }
  return null;
}

const PLACEHOLDER = /\{\{[^}]*\}\}/;

/**
 * The inline error for a JSON editor: syntax first, then the sub-schema. Text
 * containing `{{input.x}}` placeholders is only syntax-checked — the value it
 * becomes isn't known until the run, and the server validates it then.
 */
export function jsonFieldError(text, schema) {
  if (text === undefined || text === null) return null;
  if (typeof text !== 'string') return schemaError(text, schema);
  if (!text.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/\{\{[^}]*\}\}/g, '0'));
  } catch (err) {
    return `Invalid JSON: ${err.message}`;
  }
  if (PLACEHOLDER.test(text)) return null;
  return schemaError(parsed, schema);
}

/** read-only / side effect / destructive, from the tool's MCP annotations. */
export function annotationBadges(annotations = {}) {
  if (annotations?.readOnlyHint === true) return ['read-only'];
  return annotations?.destructiveHint ? ['side effect', 'destructive'] : ['side effect'];
}

/**
 * A discovered MCP tool as a spec/26 action, so the config panel, the canvas
 * node and the validator treat it like any other. Uses the server's mapped
 * `configSchema` when it sent one.
 */
export function toolToAction(tool) {
  const mapped = tool.configSchema ? { configSchema: tool.configSchema, jsonEditor: Boolean(tool.jsonEditor) } : mapInputSchema(tool.inputSchema);
  const readOnly = tool.annotations?.readOnlyHint === true;
  return {
    id: tool.name,
    name: tool.title || tool.name,
    description: tool.description || '',
    configSchema: mapped.configSchema,
    jsonEditor: mapped.jsonEditor,
    inputSchema: tool.inputSchema || null,
    annotations: tool.annotations || {},
    cacheable: readOnly,
    sideEffect: !readOnly,
    liveCapable: true,
  };
}

/** Tools from a connection's saved snapshot (spec/37 §3), when the list payload carries it. */
export function snapshotTools(connection) {
  return connection?.config?.toolsSnapshot?.tools || null;
}

/** `sideEffect` as spec/26/37 define it: MCP tools without readOnlyHint, actions that say so. */
export function actionHasSideEffect(action) {
  if (!action) return false;
  if (action.sideEffect !== undefined) return Boolean(action.sideEffect);
  return action.annotations ? action.annotations.readOnlyHint !== true : false;
}
