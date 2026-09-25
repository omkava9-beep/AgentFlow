import { genericInbound } from './inboundUtil.js';

/**
 * Registration-time safety net for inbound webhooks (spec/27 §5).
 *
 * Provider adapters live on their manifests (`inbound: { verify, parse }` in
 * github.js, stripe.js, slack.js, twilio.js, and `genericInbound` on the rest -
 * see inboundUtil.js for the contract). This only makes sure a future manifest
 * that declares triggers but forgets `inbound` still gets the documented generic
 * JSON shape, instead of silently having no inbound URL.
 *
 * Poll-based triggers (rss.new_item, spec/27 §6) have no inbound URL at all.
 */

const NO_INBOUND = new Set(['rss']);

/** Thrown by an adapter's `verify` as an alternative to returning false; answered 401. */
export class InboundSignatureError extends Error {}

export function withInbound(manifest) {
  if (!manifest || manifest.inbound || NO_INBOUND.has(manifest.id) || !(manifest.triggers || []).length) return manifest;
  return { ...manifest, inbound: genericInbound(manifest.triggers.map((t) => t.id)) };
}
