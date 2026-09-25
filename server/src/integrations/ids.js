import crypto from 'node:crypto';

/**
 * Provider-shaped ids for sandbox records, so a sandbox output reads like the
 * real API's (spec/27 §3 "numbering that looks real"): Stripe `cus_…`, Twilio
 * `SM…`, Discord snowflakes, Airtable `rec…`, Notion UUIDs.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function base62(length) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** `cus_P3x9…`, `in_…`, `re_…`, `pi_…` */
export const stripeId = (prefix) => `${prefix}_${base62(14)}`;

/** Twilio message SIDs: `SM` + 32 hex characters. */
export const twilioSid = () => `SM${crypto.randomBytes(16).toString('hex')}`;

/** Discord-style 18–19 digit snowflake (timestamp-derived, like the real ones). */
export const snowflake = () => String((BigInt(Date.now() - 1420070400000) << 22n) + BigInt(crypto.randomInt(0, 4194304)));

/** Airtable record ids: `rec` + 14 base62. */
export const airtableId = () => `rec${base62(14)}`;

export const uuid = () => crypto.randomUUID();

/** Slack-style message timestamps: `1727000000.000100`. */
export const slackTs = () => `${Math.floor(Date.now() / 1000)}.${String(crypto.randomInt(0, 1e6)).padStart(6, '0')}`;
