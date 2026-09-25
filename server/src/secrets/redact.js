/**
 * Two redaction tools with different jobs.
 *
 * `buildRedactor(secretValues)` — spec/25 §4. Built per execution from the
 * decrypted credential values of the connection a node used, and run over log
 * lines, outputs and error messages before they are persisted, emitted, cached
 * or passed downstream. It removes *known* secrets wherever they appear.
 *
 * `redactKnownSecretFields(obj, schemaSecretKeys)` — for spec/34's audit
 * `before`/`after` and anywhere else there's no decrypted value to match on. It
 * removes fields that are secret *by name* (schema `secret: true` keys plus
 * common names) and values that *look* like tokens.
 *
 * Neither mutates its input.
 */

export const MASK = '••••';
const REDACTED = '[redacted]';
const MIN_SECRET_LENGTH = 4;

// Request-metadata headers an action might echo into its output.
const SENSITIVE_HEADERS = new Set(['authorization', 'x-api-key', 'cookie', 'set-cookie', 'proxy-authorization']);

const SECRETISH_KEY = /pass(word)?|token|secret|api[-_]?key|authorization|cookie|credential|private[-_]?key/i;
const TOKEN_LOOKING_VALUE = /^(xox[abposr]-|gh[pousr]_|github_pat_|sk_(live|test)_|rk_(live|test)_|sk-ant-|af_[A-Za-z0-9]{20,}|Bearer\s+\S+|Basic\s+\S+)/;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Returns `redact(value)`, a deep, non-mutating scrubber. Strings shorter than
 * four characters are ignored as secrets: masking every "a" or "id" in an
 * output would destroy it without protecting anything.
 */
export function buildRedactor(secretValues = []) {
  const secrets = [...new Set(
    secretValues
      .filter((v) => typeof v === 'string' || typeof v === 'number')
      .map(String)
      .filter((v) => v.length >= MIN_SECRET_LENGTH),
  )].sort((a, b) => b.length - a.length); // longest first, so a secret containing another masks whole

  function scrubString(str) {
    let out = str;
    for (const secret of secrets) {
      if (out.includes(secret)) out = out.split(secret).join(MASK);
    }
    return out;
  }

  function walk(value, seen) {
    if (typeof value === 'string') return scrubString(value);
    if (Array.isArray(value)) {
      if (seen.has(value)) return seen.get(value);
      const out = [];
      seen.set(value, out);
      for (const item of value) out.push(walk(item, seen));
      return out;
    }
    if (value instanceof Error) {
      const copy = new Error(scrubString(value.message));
      copy.name = value.name;
      for (const key of ['permanent', 'retryable', 'code', 'status']) {
        if (key in value) copy[key] = value[key];
      }
      return copy;
    }
    if (isPlainObject(value)) {
      if (seen.has(value)) return seen.get(value);
      const out = {};
      seen.set(value, out);
      for (const [key, v] of Object.entries(value)) {
        out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) && typeof v === 'string' ? MASK : walk(v, seen);
      }
      return out;
    }
    return value; // numbers, booleans, null, Dates, Buffers, ObjectIds
  }

  const redact = (value) => walk(value, new WeakMap());
  redact.isEmpty = secrets.length === 0;
  return redact;
}

/**
 * Removes secret-by-name fields and token-looking values, at any depth.
 * `schemaSecretKeys` are the manifest field keys marked `secret: true`.
 */
export function redactKnownSecretFields(obj, schemaSecretKeys = []) {
  const explicit = new Set(schemaSecretKeys.map((k) => String(k).toLowerCase()));

  function walk(value, seen) {
    if (typeof value === 'string') return TOKEN_LOOKING_VALUE.test(value.trim()) ? REDACTED : value;
    if (Array.isArray(value)) {
      if (seen.has(value)) return seen.get(value);
      const out = [];
      seen.set(value, out);
      for (const item of value) out.push(walk(item, seen));
      return out;
    }
    if (isPlainObject(value)) {
      if (seen.has(value)) return seen.get(value);
      const out = {};
      seen.set(value, out);
      for (const [key, v] of Object.entries(value)) {
        const secretKey = explicit.has(key.toLowerCase()) || SECRETISH_KEY.test(key);
        // A secret-named key holding a non-empty scalar is dropped to a marker;
        // a nested object under it is still walked (e.g. `credentialHints`).
        out[key] = secretKey && v !== null && v !== undefined && typeof v !== 'object' ? REDACTED : walk(v, seen);
      }
      return out;
    }
    return value;
  }

  return walk(obj, new WeakMap());
}
