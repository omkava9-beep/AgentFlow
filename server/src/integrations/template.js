/**
 * `{{input.foo}}` interpolation for tool config fields, so a tool's output can
 * reflect what actually flowed into it from upstream.
 *
 * An unresolved reference renders empty and logs a line rather than failing the
 * node — a typo'd placeholder shouldn't take a whole run down.
 */
const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

function resolve(scope, path) {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), scope);
}

export function interpolate(template, input, logs = []) {
  if (typeof template !== 'string' || !template.includes('{{')) return template;

  return template.replace(PLACEHOLDER, (match, path) => {
    const value = resolve({ input }, path);
    if (value === undefined) {
      logs.push(`[template] unresolved reference ${match}`);
      return '';
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}

/** Interpolates every string field of a tool's resolved config. */
export function interpolateConfig(toolConfig = {}, input, logs = []) {
  const out = {};
  for (const [key, value] of Object.entries(toolConfig)) {
    out[key] = interpolate(value, input, logs);
  }
  return out;
}

const SINGLE_PLACEHOLDER = /^\{\{\s*([\w.]+)\s*\}\}$/;

/**
 * Typed resolution (spec/31 §1). A value that is exactly one placeholder
 * resolves to the raw value - an array stays an array, a number a number - so a
 * Transform can hand a list straight to a Loop. Anything else interpolates to a
 * string, as `interpolate` always has.
 *
 * `scope` is the whole template scope (`{ input, run, now }` for engine nodes),
 * not just the input, so node templates can reach run metadata too.
 */
export function resolveValue(template, scope = {}, logs = []) {
  if (typeof template !== 'string') return template;
  const single = template.trim().match(SINGLE_PLACEHOLDER);
  if (single) {
    const value = resolve(scope, single[1]);
    if (value === undefined) {
      logs.push(`[template] unresolved reference ${template.trim()}`);
      return '';
    }
    return value;
  }
  if (!template.includes('{{')) return template;
  return template.replace(PLACEHOLDER, (match, path) => {
    const value = resolve(scope, path);
    if (value === undefined) {
      logs.push(`[template] unresolved reference ${match}`);
      return '';
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}
