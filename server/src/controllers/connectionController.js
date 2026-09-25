import Connection from '../models/Connection.js';
import { mcpPool } from '../mcp/McpPool.js';
import { HttpError } from '../middleware/errorHandler.js';
import { scopedFilter, findInWorkspace } from '../tenancy/scoped.js';
import { can } from '../tenancy/permissions.js';
import {
  createConnection, updateConnection, testConnection, regenerateInboundToken,
  presentConnection, findUsage,
} from '../services/connectionService.js';

// audit() arrives with spec/34; until then the calls are already in place and
// do nothing (spec/25 §6). Only a missing module is tolerated - any other
// import error still surfaces.
let auditPromise = null;
async function recordAudit(req, action, doc, details) {
  auditPromise ||= import('../services/audit.js')
    .then((m) => m.audit)
    .catch((err) => {
      if (err?.code === 'ERR_MODULE_NOT_FOUND') return () => {};
      throw err;
    });
  const audit = await auditPromise;
  await audit(req, action, { type: 'connection', id: doc._id.toString(), name: doc.name }, {
    integration: doc.integration, name: doc.name, mode: doc.mode, ...details,
  });
}

const present = (req, doc) => presentConnection(doc, { slug: req.workspace?.slug });

export async function listConnections(req, res, next) {
  try {
    const extra = {};
    if (typeof req.query.integration === 'string' && req.query.integration) extra.integration = req.query.integration;
    const docs = await Connection.find(scopedFilter(req, extra)).sort({ integration: 1, name: 1 });
    // Viewers see which connection a node uses, but not its hints or config.
    const stripped = !can(req.role, 'connections:use');
    res.json(docs.map((d) => presentConnection(d, { slug: req.workspace?.slug, stripped })));
  } catch (err) {
    next(err);
  }
}

export async function createConnectionHandler(req, res, next) {
  try {
    const { integration, name, mode, credentials, config } = req.body || {};
    if (typeof integration !== 'string' || !integration) throw new HttpError(400, 'integration is required');
    const doc = await createConnection({
      workspaceId: req.workspaceId, userId: req.userId, integration, name, mode, credentials, config,
    });
    await recordAudit(req, 'connection.created', doc, { fields: Object.keys(doc.credentialHints || {}) });
    res.status(201).json(present(req, doc));
  } catch (err) {
    next(err);
  }
}

export async function getConnection(req, res, next) {
  try {
    const doc = await findInWorkspace(Connection, req.params.id, req);
    res.json(present(req, doc));
  } catch (err) {
    next(err);
  }
}

export async function updateConnectionHandler(req, res, next) {
  try {
    const doc = await findInWorkspace(Connection, req.params.id, req);
    const before = { name: doc.name, mode: doc.mode };
    const { changed } = await updateConnection(doc, req.body || {});
    // spec/37 §2: an edited MCP server gets a fresh client (stdio child killed).
    if (doc.integration === 'mcp' && (changed.config.length || changed.credentials.length)) mcpPool.close(doc._id);

    if (changed.credentials.length) {
      await recordAudit(req, 'connection.credentials_changed', doc, { fields: changed.credentials });
    }
    if (changed.mode) {
      await recordAudit(req, 'connection.mode_changed', doc, { before: { mode: before.mode }, after: { mode: doc.mode } });
    }
    if (changed.name || changed.config.length) {
      await recordAudit(req, 'connection.updated', doc, {
        fields: [...(changed.name ? ['name'] : []), ...changed.config],
        ...(changed.name ? { before: { name: before.name }, after: { name: doc.name } } : {}),
      });
    }
    res.json(present(req, doc));
  } catch (err) {
    next(err);
  }
}

export async function testConnectionHandler(req, res, next) {
  try {
    const doc = await findInWorkspace(Connection, req.params.id, req);
    const result = await testConnection(doc);
    await recordAudit(req, 'connection.tested', doc, { status: result.status });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function connectionUsage(req, res, next) {
  try {
    const doc = await findInWorkspace(Connection, req.params.id, req);
    res.json(await findUsage(req.workspaceId, doc._id));
  } catch (err) {
    next(err);
  }
}

export async function deleteConnection(req, res, next) {
  try {
    const doc = await findInWorkspace(Connection, req.params.id, req);
    const force = req.query.force === 'true' || req.query.force === '1';
    const usage = await findUsage(req.workspaceId, doc._id);
    if (usage.length && !force) {
      return res.status(409).json({ error: `"${doc.name}" is used by ${usage.length} workflow${usage.length === 1 ? '' : 's'}`, usage });
    }
    await doc.deleteOne();
    if (doc.integration === 'mcp') mcpPool.close(doc._id);
    await recordAudit(req, 'connection.deleted', doc, { forced: Boolean(usage.length), usageCount: usage.length });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function regenerateInboundTokenHandler(req, res, next) {
  try {
    const doc = await findInWorkspace(Connection, req.params.id, req);
    await regenerateInboundToken(doc);
    await recordAudit(req, 'connection.updated', doc, { fields: ['inboundToken'] });
    res.json({ inboundUrl: present(req, doc).inboundUrl });
  } catch (err) {
    next(err);
  }
}
