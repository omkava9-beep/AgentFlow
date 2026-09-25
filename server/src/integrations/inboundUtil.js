import crypto from 'node:crypto';

/**
 * Shared pieces for manifests' `inbound` handlers (spec/27 §5).
 *
 * The contract every manifest's `inbound` follows — the inbound route calls:
 *
 *   inbound.verify({ headers, rawBody, connection }) → true | false
 *     Only rejects when the connection has a signing secret configured and the
 *     signature doesn't match; with no secret it returns true (the capability
 *     token in the URL is then the only credential, like spec/13's webhook).
 *
 *   inbound.parse({ headers, rawBody, body, connection })
 *     → { triggerId, data, deliveryId? }   a mapped event
 *     | { respond: { status, body } }      answer the provider directly (Slack's
 *                                           url_verification challenge)
 *     | null                               an event this integration doesn't map
 *
 * `headers` are lowercased (Express already does that), `rawBody` is the exact
 * Buffer that arrived (HMACs are computed over it), and `body` is `parseBody()`'s
 * result: JSON or form-encoded fields.
 */

export function parseBody(headers = {}, rawBody) {
  const text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody ?? '');
  if (!text) return {};
  const type = String(headers['content-type'] || '');
  if (type.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function hmacHex(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/** Constant-time compare of two hex strings; false for any length mismatch. */
export function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !/^[0-9a-f]*$/i.test(a + b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/**
 * The "documented generic JSON shape" for integrations without a provider
 * format: `{ "trigger": "<triggerId>", "data": { … } }`. Anything else, or an
 * unknown trigger id, is ignored rather than rejected (providers retry errors).
 */
export function genericInbound(triggerIds) {
  const known = new Set(triggerIds);
  return {
    verify: () => true,
    parse: ({ body }) => {
      if (!body || typeof body !== 'object' || !known.has(body.trigger)) return null;
      return { triggerId: body.trigger, data: body.data ?? {} };
    },
  };
}
