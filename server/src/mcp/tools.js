import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Connection from '../models/Connection.js';
import { toolCache } from '../cache/TTLCache.js';
import { integrationsConfig } from '../config/integrations.js';
import { PermanentFailure } from '../queue/errors.js';
import { stableStringify } from '../utils/stableStringify.js';
import { mcpPool } from './McpPool.js';
import { getAllowlistEntry } from './allowlist.js';
import { schemaToConfig } from './schemaToConfig.js';

/**
 * Tool discovery for MCP connections (spec/37 §3): `tools/list`, cached in the
 * TTL cache per connection for 5 minutes, and saved on the connection as
 * `config.toolsSnapshot` so nodes still validate and render after a restart or
 * while the server is offline.
 */

const TOOLS_TTL_MS = 5 * 60 * 1000;
const cacheKey = (connectionId) => `mcp:tools:${connectionId}`;

/**
 * spec/37 §4: live when INTEGRATIONS_LIVE is on and the connection is in live
 * mode - except allowlist entries marked `sandboxSafe` (the bundled demo
 * server), which ship with AgentFlow, only touch sandbox data, and are always
 * called. Otherwise no MCP traffic happens at all.
 */
export function mcpMode(connection, liveEnabled = integrationsConfig.live) {
  const config = connection?.config || {};
  if (config.transport === 'stdio' && getAllowlistEntry(config.allowlistId)?.sandboxSafe) return 'live';
  if (liveEnabled && connection?.mode === 'live') return 'live';
  return 'sandbox';
}

/** Which server a snapshot came from - a snapshot of an old URL is not this server's. */
export function targetFingerprint(connection) {
  const { transport, url, allowlistId } = connection?.config || {};
  return crypto.createHash('sha256').update(stableStringify({ transport, url: url || null, allowlistId: allowlistId || null })).digest('hex').slice(0, 16);
}

const clean = (tool) => ({
  name: tool.name,
  title: tool.title || tool.annotations?.title || null,
  description: tool.description || '',
  inputSchema: tool.inputSchema || { type: 'object', properties: {} },
  ...(tool.outputSchema && { outputSchema: tool.outputSchema }),
  annotations: tool.annotations || {},
});

function validSnapshot(connection) {
  const snap = connection?.config?.toolsSnapshot;
  if (!snap?.tools || snap.fingerprint !== targetFingerprint(connection)) return null;
  return snap;
}

async function saveSnapshot(connection, workspaceId, snapshot) {
  if (!mongoose.isValidObjectId(connection.id)) return;
  await Connection.updateOne({ _id: connection.id, workspaceId }, { $set: { 'config.toolsSnapshot': snapshot, status: 'ok', lastError: null } });
  connection.config = { ...(connection.config || {}), toolsSnapshot: snapshot };
}

/**
 * → { tools, fetchedAt, serverInfo, source: 'live' | 'cache' | 'snapshot' }.
 * `force` skips the cache (Refresh tools, Test connection). In sandbox mode the
 * saved snapshot is served and the server is never contacted.
 */
export async function discoverTools(connection, workspaceId, { force = false } = {}) {
  if (!connection || connection.id === 'sandbox') throw new PermanentFailure('An MCP tool needs an MCP server connection');
  const id = String(connection.id);
  const fingerprint = targetFingerprint(connection);

  if (mcpMode(connection) !== 'live') {
    const snap = validSnapshot(connection);
    if (!snap) throw new PermanentFailure('No tool list available offline; test the connection once with INTEGRATIONS_LIVE on');
    return { ...snap, source: 'snapshot' };
  }

  if (!force) {
    const hit = toolCache.get(cacheKey(id));
    if (hit && hit.fingerprint === fingerprint) return { ...hit, source: 'cache' };
  }

  const { tools, serverInfo } = await mcpPool.listTools(connection, workspaceId);
  const snapshot = {
    tools: tools.map(clean),
    fetchedAt: new Date(),
    serverInfo: serverInfo ? { name: serverInfo.name, version: serverInfo.version } : null,
    fingerprint,
  };
  toolCache.set(cacheKey(id), snapshot, TOOLS_TTL_MS);
  // notifications/tools/list_changed drops the cached list (spec/37 §2).
  mcpPool.onToolsChanged(id, () => toolCache.set(cacheKey(id), undefined, 1));
  await saveSnapshot(connection, workspaceId, snapshot);
  return { ...snapshot, source: 'live' };
}

/** A tool as the tools endpoint and the config panel see it. */
export function presentTool(tool) {
  const { configSchema, jsonEditor } = schemaToConfig(tool.inputSchema);
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    annotations: tool.annotations || {},
    readOnly: tool.annotations?.readOnlyHint === true,
    configSchema,
    jsonEditor,
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema && { outputSchema: tool.outputSchema }),
  };
}
