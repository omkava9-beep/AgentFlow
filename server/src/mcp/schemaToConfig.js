/**
 * JSON Schema → the declarative form spec/21/26 renders (spec/37 §3), plus the
 * small validator that checks arguments against the tool's schema before
 * anything is sent to the server.
 *
 * Deliberately shallow, like the form renderer itself: flat scalar properties
 * get real fields; anything structured gets a JSON editor for that property.
 */

const COMPLEX = ['$ref', 'oneOf', 'anyOf', 'allOf', 'not'];
const MAX_FIELDS = 25;

/** The one-JSON-editor-for-everything fallback key. */
export const WHOLE_ARGS_KEY = '__args';

const typeOf = (prop) => (Array.isArray(prop?.type) ? prop.type.find((t) => t !== 'null') : prop?.type);
const isComplex = (prop) => !prop || typeof prop !== 'object' || COMPLEX.some((k) => k in prop)
  || ['object', 'array'].includes(typeOf(prop)) || (!typeOf(prop) && !Array.isArray(prop.enum));

function fieldFor(key, prop, required) {
  const base = {
    key,
    label: prop.title || key,
    required,
    ...(prop.description && { description: prop.description }),
    ...(prop.default !== undefined && { default: prop.default }),
  };
  if (isComplex(prop)) {
    return { ...base, type: 'json', placeholder: typeOf(prop) === 'array' ? '[ … ]' : '{ … }', schema: prop };
  }
  if (Array.isArray(prop.enum) && prop.enum.every((v) => typeof v === 'string')) {
    return { ...base, type: 'select', options: prop.enum.map((v) => ({ value: v, label: v })) };
  }
  switch (typeOf(prop)) {
    case 'number':
    case 'integer':
      return {
        ...base,
        type: 'number',
        ...(prop.minimum !== undefined && { min: prop.minimum }),
        ...(prop.maximum !== undefined && { max: prop.maximum }),
      };
    case 'boolean':
      return { ...base, type: 'boolean' };
    default: {
      const long = (prop.maxLength || 0) > 200 || /\b(body|content)\b/i.test(prop.description || '') || /^(body|content)$/i.test(key);
      return {
        ...base,
        type: long ? 'textarea' : 'text',
        ...(prop.format && { placeholder: prop.format }),
      };
    }
  }
}

/**
 * → { configSchema, jsonEditor } where `jsonEditor` is true when the whole
 * argument object is one JSON editor (non-object schema, or > 25 properties).
 */
export function schemaToConfig(inputSchema) {
  const schema = inputSchema && typeof inputSchema === 'object' ? inputSchema : { type: 'object', properties: {} };
  const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const keys = Object.keys(props);
  const notObject = typeOf(schema) && typeOf(schema) !== 'object';
  if (notObject || keys.length > MAX_FIELDS || COMPLEX.some((k) => k in schema)) {
    return {
      jsonEditor: true,
      configSchema: [{ key: WHOLE_ARGS_KEY, label: 'Arguments (JSON)', type: 'json', required: false, placeholder: '{ … }', schema }],
    };
  }
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return { jsonEditor: false, configSchema: keys.map((k) => fieldFor(k, props[k] || {}, required.has(k))) };
}

/**
 * The argument object to send: prepared params (spec/26 prepareParams already
 * applied templates, defaults and JSON parsing) with empty optional values
 * dropped, so a blank form field isn't sent as "" to a strict server.
 */
export function toArguments(params, { jsonEditor, configSchema }) {
  if (jsonEditor) {
    // An agent's tool call passes the arguments directly (no __args wrapper).
    const whole = params?.[WHOLE_ARGS_KEY];
    return whole !== undefined ? whole : Object.fromEntries(Object.entries(params || {}).filter(([k]) => k !== WHOLE_ARGS_KEY));
  }
  const known = new Set(configSchema.map((f) => f.key));
  const out = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    // Extra keys (an agent guessing) are passed through; the schema check decides.
    out[key] = value;
  }
  for (const key of known) if (out[key] === '') delete out[key];
  return out;
}

/** Placeholder sample value for a schema (spec/37 §4 sandbox outputs). */
export function sampleFor(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 4) return null;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  switch (typeOf(schema)) {
    case 'string': return schema.format === 'date' ? '2026-01-01' : schema.format === 'email' ? 'sample@example.test' : 'sample';
    case 'number': return 0;
    case 'integer': return 0;
    case 'boolean': return false;
    case 'array': return [];
    case 'object': {
      const out = {};
      for (const [k, v] of Object.entries(schema.properties || {})) out[k] = sampleFor(v, depth + 1);
      return out;
    }
    default: return null;
  }
}

const jsonType = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);

/**
 * Minimal JSON Schema check: type, required, enum, min/max, nested
 * properties/items. Composition keywords and $ref are accepted as-is (the
 * server has the final word). → the first problem as a string, or null.
 */
export function validateAgainstSchema(value, schema, path = 'arguments') {
  if (!schema || typeof schema !== 'object' || COMPLEX.some((k) => k in schema)) return null;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : null;
  const actual = jsonType(value);
  if (types && !types.some((t) => t === actual || (t === 'number' && actual === 'integer'))) {
    return `${path} must be ${types.join(' or ')} (got ${actual})`;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    return `${path} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`;
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return `${path} must be ≥ ${schema.minimum}`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${path} must be ≤ ${schema.maximum}`;
  }
  if (actual === 'object') {
    for (const key of schema.required || []) {
      if (value[key] === undefined) return `${path}.${key} is required`;
    }
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (value[key] === undefined) continue;
      const problem = validateAgainstSchema(value[key], sub, `${path}.${key}`);
      if (problem) return problem;
    }
  }
  if (actual === 'array' && schema.items && typeof schema.items === 'object') {
    for (let i = 0; i < value.length; i += 1) {
      const problem = validateAgainstSchema(value[i], schema.items, `${path}[${i}]`);
      if (problem) return problem;
    }
  }
  return null;
}
