import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * The credential vault (spec/25): AES-256-GCM over a JSON-serialized object.
 *
 * The additional authenticated data is `${workspaceId}:${connectionId}`, so a
 * ciphertext copied into another connection or another workspace fails to
 * decrypt instead of quietly handing over someone else's token.
 */
const ALGORITHM = 'aes-256-gcm';
const VERSION = 1;

export class VaultError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VaultError';
  }
}

// env.js has already validated the length; decode once.
const KEY = Buffer.from(env.secretsMasterKey, 'base64');

/** Builds the AAD string both sides must agree on. */
export function connectionAad(workspaceId, connectionId) {
  return `${workspaceId}:${connectionId}`;
}

/** → { iv, tag, ciphertext, v }, all base64, fresh 12-byte IV every call. */
export function encrypt(plainObject, aad) {
  if (!aad) throw new VaultError('encrypt requires additional authenticated data');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  cipher.setAAD(Buffer.from(String(aad), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(plainObject ?? {}), 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    v: VERSION,
  };
}

/** Throws VaultError on a wrong key, wrong AAD or any tampering. */
export function decrypt(blob, aad) {
  if (!blob?.iv || !blob?.tag || !blob?.ciphertext) throw new VaultError('Malformed encrypted credentials');
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(blob.iv, 'base64'));
    decipher.setAAD(Buffer.from(String(aad), 'utf8'));
    decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(blob.ciphertext, 'base64')), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch {
    // Deliberately vague: whether it was the key, the AAD or a flipped bit is
    // not something a caller can act on, and it's not worth leaking.
    throw new VaultError('Credentials could not be decrypted — re-enter them');
  }
}

/** The masked hint stored beside the ciphertext: `••••` + last 4 for values of 12+ chars. */
export function hintFor(value) {
  const s = String(value ?? '');
  return s.length >= 12 ? `••••${s.slice(-4)}` : '••••';
}
