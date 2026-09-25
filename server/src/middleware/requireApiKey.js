import crypto from 'node:crypto';
import ApiKey from '../models/ApiKey.js';
import Workspace from '../models/Workspace.js';
import { HttpError } from './errorHandler.js';

const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const LAST_USED_THROTTLE_MS = 60_000;

/**
 * SHA-256, not bcrypt, on purpose: keys are 40 random base62 characters (~238
 * bits), not guessable passwords, and every external call hashes one. A slow
 * hash would buy nothing here but latency.
 */
export function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/** `af_` + 40 base62 characters, drawn with rejection sampling so every character is equally likely. */
export function generateApiKey() {
  let body = '';
  while (body.length < 40) {
    for (const byte of crypto.randomBytes(48)) {
      // 248 = 62 * 4: bytes at or above it would bias the modulo, so skip them.
      if (byte < 248 && body.length < 40) body += KEY_ALPHABET[byte % 62];
    }
  }
  const key = `af_${body}`;
  return { key, prefix: key.slice(0, 11), keyHash: hashApiKey(key) };
}

function readKey(req) {
  const header = req.get('Authorization') || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return (req.get('X-API-Key') || '').trim() || null;
}

/**
 * Authenticates an external caller for `/api/w/:slug/**` (spec/24 §6).
 *   unknown / revoked / missing key  -> 401 (indistinguishable)
 *   key for a different workspace    -> 404 (don't confirm the other one exists)
 *   key lacks the scope              -> 403
 */
export function requireApiKey(scope) {
  return async (req, res, next) => {
    try {
      const key = readKey(req);
      const apiKey = key && await ApiKey.findOne({ keyHash: hashApiKey(key), revokedAt: null });
      if (!apiKey) throw new HttpError(401, 'Invalid API key');

      const workspace = await Workspace.findOne({ slug: String(req.params.slug || '').toLowerCase() });
      if (!workspace || String(workspace._id) !== String(apiKey.workspaceId)) {
        throw new HttpError(404, 'Workspace not found');
      }
      if (!apiKey.scopes.includes(scope)) {
        throw new HttpError(403, `This API key is missing the "${scope}" scope`);
      }

      req.workspaceId = String(workspace._id);
      req.workspace = workspace;
      req.apiKey = apiKey;

      // Throttled so a busy integration doesn't write on every request, and not
      // awaited: bookkeeping must never slow or fail the call itself.
      const now = Date.now();
      if (!apiKey.lastUsedAt || now - apiKey.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
        ApiKey.updateOne({ _id: apiKey._id }, { $set: { lastUsedAt: new Date(now) } })
          .catch((err) => console.error('[api-key] lastUsedAt update failed:', err));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
