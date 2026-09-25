import { IntegrationRegistry } from '../integrations/IntegrationRegistry.js';
import { HttpError } from '../middleware/errorHandler.js';
import { env } from '../config/env.js';
import SandboxRecord from '../models/SandboxRecord.js';
import { createSandboxStore } from '../integrations/sandboxStore.js';
import { scopedFilter } from '../tenancy/scoped.js';
import { audit } from '../services/audit.js';

/** The whole catalogue - what the palette, config panel and trigger picker render from. */
export function list(req, res) {
  res.json({
    integrations: IntegrationRegistry.list(),
    // The panel shows these as the effective values behind an unset override,
    // so it can say "server default (10%)" instead of just "unset".
    defaults: { failureRate: env.defaultToolFailureRate, maxAttempts: env.queueMaxAttempts },
    // false → the client banner explains why nothing is posting (spec/26 edge cases).
    liveEnabled: IntegrationRegistry.liveEnabled,
    // Operator switches the palette needs to know about (spec/31: Code can be
    // turned off for the whole deployment).
    features: { codeNode: env.codeNodeEnabled },
  });
}

export function getOne(req, res, next) {
  const manifest = IntegrationRegistry.describe(req.params.id);
  if (!manifest) return next(new HttpError(404, 'Integration not found'));
  res.json(manifest);
}

/** Static actions plus a connection's dynamic ones (spec/37's MCP tools). */
export async function actions(req, res, next) {
  try {
    const connectionId = req.query.connectionId || null;
    const result = await IntegrationRegistry.actionsFor(req.params.id, { workspaceId: req.workspaceId, connectionId });
    if (!result) throw new HttpError(404, 'Integration not found');
    res.json({ actions: result });
  } catch (err) {
    // A connection from another workspace resolves to "not found" (spec/25).
    if (err.permanent) return next(new HttpError(404, err.message));
    next(err);
  }
}

function sandboxFor(req) {
  if (!IntegrationRegistry.describe(req.params.id)) throw new HttpError(404, 'Integration not found');
  return createSandboxStore({ workspaceId: req.workspaceId, integration: req.params.id });
}

/**
 * The integration detail page's "Sandbox data" tab (spec/27): what this
 * workspace's sandbox for one integration holds. Collections starting with `_`
 * are internal markers (seeding, counters) and stay hidden.
 */
export async function getSandbox(req, res, next) {
  try {
    const store = sandboxFor(req);
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const prefix = `${req.params.id}.`;
    const [collections, rows] = await Promise.all([
      store.collections(),
      SandboxRecord.find(scopedFilter(req, { integration: req.params.id, collectionName: { $not: new RegExp(`^${prefix.replace('.', '\\.')}_`) } }))
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean(),
    ]);
    res.json({
      collections,
      records: rows.map((r) => ({
        id: String(r._id),
        collection: r.collectionName.startsWith(prefix) ? r.collectionName.slice(prefix.length) : r.collectionName,
        doc: r.doc,
        runId: r.runId ? String(r.runId) : null,
        updatedAt: r.updatedAt,
      })),
    });
  } catch (err) {
    next(err);
  }
}

/** "Reset sandbox": drops this integration's sandbox state in this workspace only. */
export async function resetSandbox(req, res, next) {
  try {
    const store = sandboxFor(req);
    const deleted = await store.reset();
    // No connection document is involved, so the target carries only the
    // integration's name (targetId is an ObjectId).
    await audit(req, 'connection.sandbox_reset', { type: 'connection', id: null, name: `${req.params.id} sandbox` }, { meta: { integration: req.params.id, deleted } });
    res.json({ deleted });
  } catch (err) {
    next(err);
  }
}
