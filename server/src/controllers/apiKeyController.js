import ApiKey, { API_KEY_SCOPES } from '../models/ApiKey.js';
import { HttpError } from '../middleware/errorHandler.js';
import { findInWorkspace, scopedFilter } from '../tenancy/scoped.js';
import { generateApiKey } from '../middleware/requireApiKey.js';
import { audit } from '../services/audit.js';

/** Never the key or its hash - after creation a key is only ever shown by its prefix. */
function present(apiKey) {
  const creator = apiKey.createdBy;
  return {
    id: apiKey._id.toString(),
    name: apiKey.name,
    prefix: apiKey.prefix,
    scopes: apiKey.scopes,
    createdBy: creator && creator._id
      ? { id: creator._id.toString(), email: creator.email, name: creator.name }
      : creator ? { id: creator.toString() } : null,
    lastUsedAt: apiKey.lastUsedAt,
    revokedAt: apiKey.revokedAt,
    createdAt: apiKey.createdAt,
  };
}

export async function listApiKeys(req, res, next) {
  try {
    const keys = await ApiKey.find(scopedFilter(req))
      .populate('createdBy', 'email name')
      .sort({ createdAt: -1 });
    res.json(keys.map(present));
  } catch (err) {
    next(err);
  }
}

export async function createApiKey(req, res, next) {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) throw new HttpError(400, 'A key name is required');
    if (name.length > 100) throw new HttpError(400, 'Key names are limited to 100 characters');

    const scopes = Array.isArray(req.body?.scopes) ? [...new Set(req.body.scopes)] : [];
    if (!scopes.length) throw new HttpError(400, 'Choose at least one scope');
    const unknown = scopes.filter((s) => !API_KEY_SCOPES.includes(s));
    if (unknown.length) throw new HttpError(400, `Unknown scope: ${unknown.join(', ')}`);

    const { key, prefix, keyHash } = generateApiKey();
    const apiKey = await ApiKey.create({
      workspaceId: req.workspaceId, name, prefix, keyHash, scopes, createdBy: req.userId,
    });
    await apiKey.populate('createdBy', 'email name');
    // Name, prefix and scopes only: never the key or its hash.
    await audit(req, 'apikey.created', { type: 'apiKey', id: apiKey._id, name: apiKey.name },
      { meta: { prefix: apiKey.prefix, scopes: apiKey.scopes } });
    // The one and only time the plaintext key leaves the server.
    res.status(201).json({ apiKey: present(apiKey), key });
  } catch (err) {
    next(err);
  }
}

export async function revokeApiKey(req, res, next) {
  try {
    const apiKey = await findInWorkspace(ApiKey, req.params.keyId, req);
    // Idempotent: revoking a revoked key keeps its original revocation time.
    if (!apiKey.revokedAt) {
      apiKey.revokedAt = new Date();
      await apiKey.save();
      await audit(req, 'apikey.revoked', { type: 'apiKey', id: apiKey._id, name: apiKey.name },
        { meta: { prefix: apiKey.prefix, scopes: apiKey.scopes } });
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
