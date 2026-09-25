import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspace, requirePermission } from '../middleware/requireWorkspace.js';
import { HttpError } from '../middleware/errorHandler.js';
import { findInWorkspace } from '../tenancy/scoped.js';
import Connection from '../models/Connection.js';
import { resolveConnection } from '../services/connectionService.js';
import { listAllowlist } from '../mcp/allowlist.js';
import { discoverTools, presentTool } from '../mcp/tools.js';

/**
 * spec/37 API.
 *
 *   GET  /api/mcp/allowlist                                   connections:manage
 *   GET  /api/workspaces/:workspaceId/connections/:cid/mcp/tools    connections:use
 *   POST /api/workspaces/:workspaceId/connections/:cid/mcp/refresh  connections:use
 *
 * The tools routes are also mounted under /api/connections/:cid/mcp, like the
 * connections routes themselves (workspace from X-Workspace-Id).
 */

export const allowlistRouter = Router();
allowlistRouter.get('/allowlist', requireAuth, requireWorkspace, requirePermission('connections:manage'), (req, res) => {
  // Never command, args or env - only what the picker shows.
  res.json(listAllowlist());
});

export const toolsRouter = Router({ mergeParams: true });
toolsRouter.use(requireAuth, requireWorkspace, requirePermission('connections:use'));

async function loadMcpConnection(req) {
  const doc = await findInWorkspace(Connection, req.params.cid, req);
  if (doc.integration !== 'mcp') throw new HttpError(400, `"${doc.name}" is not an MCP server connection`);
  return resolveConnection(req.workspaceId, doc._id, 'mcp');
}

function respond(res, found) {
  res.json({
    tools: found.tools.map(presentTool),
    fetchedAt: found.fetchedAt,
    serverInfo: found.serverInfo || null,
    source: found.source,
  });
}

toolsRouter.get('/tools', async (req, res, next) => {
  try {
    const connection = await loadMcpConnection(req);
    try {
      respond(res, await discoverTools(connection, req.workspaceId));
    } catch (err) {
      // Server unreachable: the saved snapshot is still worth showing.
      const snap = connection.config?.toolsSnapshot;
      if (snap?.tools) return res.json({ ...{ tools: snap.tools.map(presentTool), fetchedAt: snap.fetchedAt, serverInfo: snap.serverInfo || null }, source: 'snapshot', error: err.message });
      throw new HttpError(err.permanent ? 400 : 502, err.message);
    }
  } catch (err) {
    next(err);
  }
});

toolsRouter.post('/refresh', async (req, res, next) => {
  try {
    const connection = await loadMcpConnection(req);
    try {
      respond(res, await discoverTools(connection, req.workspaceId, { force: true }));
    } catch (err) {
      throw new HttpError(err.permanent ? 400 : 502, err.message);
    }
  } catch (err) {
    next(err);
  }
});
