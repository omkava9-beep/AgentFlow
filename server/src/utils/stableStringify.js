/**
 * JSON.stringify with object keys sorted at every depth, so two equal configs
 * saved in different key orders produce the same string. Used for cache keys
 * (spec/25 §5), where key-order sensitivity turns equal inputs into misses.
 *
 * Mirrors JSON.stringify's rules: `toJSON` is honoured (Dates, ObjectIds),
 * `undefined`/functions/symbols are dropped from objects and become `null` in
 * arrays, and cycles throw.
 */
export function stableStringify(value) {
  const stack = [];

  function encode(v) {
    if (v !== null && typeof v === 'object' && typeof v.toJSON === 'function') v = v.toJSON();
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') return undefined;
    if (v === null || typeof v !== 'object') return JSON.stringify(v);

    if (stack.includes(v)) throw new TypeError('stableStringify: cannot serialize a circular structure');
    stack.push(v);
    let out;
    if (Array.isArray(v)) {
      out = `[${v.map((item) => encode(item) ?? 'null').join(',')}]`;
    } else {
      const parts = [];
      for (const key of Object.keys(v).sort()) {
        const encoded = encode(v[key]);
        if (encoded !== undefined) parts.push(`${JSON.stringify(key)}:${encoded}`);
      }
      out = `{${parts.join(',')}}`;
    }
    stack.pop();
    return out;
  }

  return encode(value);
}
