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
