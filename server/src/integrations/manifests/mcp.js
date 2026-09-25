import { defineIntegration } from '../defineAction.js';
import { PermanentFailure } from '../../queue/errors.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { integrationsConfig } from '../../config/integrations.js';
import { listAllowlist, getAllowlistEntry } from '../../mcp/allowlist.js';
import { mcpPool } from '../../mcp/McpPool.js';
import { discoverTools, mcpMode } from '../../mcp/tools.js';
import { schemaToConfig, toArguments, sampleFor, validateAgainstSchema } from '../../mcp/schemaToConfig.js';

/**
 * MCP servers as connections (spec/37). One catalogue entry with no static
 * actions: each tool a connected server offers becomes an action at run time,
 * resolved per connection from the saved tools snapshot.
 *
 * Nothing here imports the MCP SDK - McpPool loads it lazily on first use.
 */

const textOf = (result) => (result?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n\n');

/**
 * tools/call result → node output (spec/37 §3). structuredContent is used as-is;
 * otherwise `{ text, content }` with non-text blocks kept as metadata only -
 * binary data never lands in a run document.
 */
export function mapToolResult(result) {
  if (result?.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent;
  const content = [];
  for (const block of result?.content || []) {
    if (block.type === 'text') continue;
    if (block.type === 'image' || block.type === 'audio') {
      content.push({ type: block.type, mimeType: block.mimeType || null, bytes: block.data ? Buffer.byteLength(block.data, 'base64') : 0 });
    } else if (block.type === 'resource') {
      content.push({ type: 'resource', uri: block.resource?.uri || null, mimeType: block.resource?.mimeType || null });
    } else if (block.type === 'resource_link') {
      content.push({ type: 'resource_link', uri: block.uri || null, name: block.name || null, mimeType: block.mimeType || null });
    } else {
      content.push({ type: block.type });
    }
  }
  return { text: textOf(result), content };
}

function argumentsFor(ctx, tool, shape) {
  const args = toArguments(ctx.params, shape);
  // Checked before anything is sent: a template that resolved to the wrong
  // type fails permanently, naming the field (spec/37 edge cases).
  const problem = validateAgainstSchema(args, tool.inputSchema || { type: 'object' });
  if (problem) throw new PermanentFailure(`MCP tool "${tool.name}": ${problem}`);
  return args;
}

/** One discovered tool → a manifest action (spec/26 shape plus the MCP extras). */
export function toolToAction(tool) {
  const shape = schemaToConfig(tool.inputSchema);
  const readOnly = tool.annotations?.readOnlyHint === true;
  return {
    id: tool.name,
    name: tool.title || tool.name,
    description: tool.description || '',
    configSchema: shape.configSchema,
    jsonEditor: shape.jsonEditor,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema || null,
    annotations: tool.annotations || {},
    outputSample: tool.outputSchema ? sampleFor(tool.outputSchema) : null,
    // Only tools the server marks read-only are cacheable (the key carries the
    // connection id); anything else counts as a side effect for agents too.
    cacheable: readOnly,
    sideEffect: !readOnly,
    // A placeholder or a real protocol exchange - never a simulated failure.
    mockBehavior: false,
    decideMode: ({ connection, liveEnabled }) => mcpMode(connection, liveEnabled),
    async live(ctx) {
      const args = argumentsFor(ctx, tool, shape);
      const result = await mcpPool.callTool(ctx.connection, ctx.workspaceId, {
        name: tool.name, args, runId: ctx.runId, signal: ctx.signal,
      });
      // The tool ran and refused: running it again won't change that.
      if (result?.isError) throw new PermanentFailure(`MCP tool "${tool.name}" returned an error: ${textOf(result) || 'no details'}`);
      return mapToolResult(result);
    },
    // INTEGRATIONS_LIVE=false must mean "no external traffic": a correctly
    // shaped placeholder keeps workflows with MCP nodes runnable end to end.
    sandbox(ctx) {
      const args = argumentsFor(ctx, tool, shape);
      if (tool.outputSchema) return { ...sampleFor(tool.outputSchema), sandbox: true };
      return { text: `[sandbox] ${tool.name} would be called with ${JSON.stringify(args)}`, sandbox: true };
    },
  };
}

async function resolveAction({ actionId, connection, workspaceId }) {
  if (!connection || connection.id === 'sandbox') throw new PermanentFailure('An MCP tool node needs an MCP server connection');
  const serverName = connection.name || 'the server';
  let found = await discoverTools(connection, workspaceId);
  let tool = found.tools.find((t) => t.name === actionId);
  // A stale cache or snapshot: look once more before declaring the tool gone.
  if (!tool && found.source !== 'live' && mcpMode(connection) === 'live') {
    found = await discoverTools(connection, workspaceId, { force: true });
    tool = found.tools.find((t) => t.name === actionId);
  }
  if (!tool) throw new PermanentFailure(`MCP tool "${actionId}" is not offered by ${serverName}`);
  return toolToAction(tool);
}

const TRANSPORTS = [
  { value: 'http', label: 'Remote (Streamable HTTP)' },
  { value: 'stdio', label: 'Local (allowlisted server)' },
];

export default defineIntegration({
  id: 'mcp',
  name: 'MCP servers',
  icon: 'mcp',
  category: 'ai',
  description: 'Model Context Protocol servers: every tool a server offers becomes an action, usable by tool nodes and by agents.',
  auth: {
    type: 'custom',
    fields: [
      { key: 'transport', label: 'Transport', type: 'select', options: TRANSPORTS, default: 'http', required: true },
      { key: 'url', label: 'Server URL', type: 'text', placeholder: 'https://mcp.example.com/mcp' },
      { key: 'headerName', label: 'Auth header name', type: 'text', placeholder: 'Authorization' },
      { key: 'authHeader', label: 'Auth header value', type: 'text', secret: true, placeholder: 'Bearer …' },
      {
        key: 'allowlistId',
        label: 'Local server',
        type: 'select',
        options: listAllowlist().map((e) => ({ value: e.id, label: e.name, description: e.description })),
      },
    ],
  },
  actions: [],
  // Resolved per connection from its tools snapshot (spec/37 §3).
  dynamicActions: listConnectionActions,

  /** Called by the connections service on create/update (spec/37 §1, C4). */
  validateConnection({ config = {} }) {
    const { transport, url, allowlistId } = config;
    if (transport === 'stdio') {
      if (!allowlistId || !getAllowlistEntry(allowlistId)) throw new HttpError(400, `Unknown allowlisted MCP server: ${allowlistId || '(none)'}`);
      if (url) throw new HttpError(400, 'A local MCP server takes an allowlistId, not a URL');
      return;
    }
    if (transport === 'http') {
      if (allowlistId) throw new HttpError(400, 'A remote MCP server takes a URL, not an allowlistId');
      if (!url) throw new HttpError(400, 'Server URL is required');
      let parsed;
      try { parsed = new URL(url); } catch { throw new HttpError(400, 'Server URL is not a valid URL'); }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new HttpError(400, 'Server URL must be http or https');
      return;
    }
    throw new HttpError(400, 'transport must be "http" or "stdio"');
  },

  resolveAction,

  /** Test connection: initialize + tools/list, and save the snapshot. */
  async test({ connection, workspaceId }) {
    if (mcpMode(connection, integrationsConfig.live) !== 'live') {
      return { ok: false, message: "Live calls are disabled (INTEGRATIONS_LIVE=false) - this MCP server can't be reached" };
    }
    try {
      const found = await discoverTools(connection, workspaceId, { force: true });
      const info = found.serverInfo ? `${found.serverInfo.name} ${found.serverInfo.version || ''}`.trim() : 'MCP server';
      return { ok: true, message: `${info} · ${found.tools.length} tool${found.tools.length === 1 ? '' : 's'}` };
    } catch (err) {
      const blocked = /network policy/i.test(err.message);
      return { ok: false, message: blocked ? `blocked by network policy (${err.message})` : err.message };
    }
  },
});

/** Resolved lazily by the registry's actionsFor (client listing). */
export async function listConnectionActions({ connection, workspaceId }) {
  if (!connection || connection.id === 'sandbox') return [];
  const found = await discoverTools(connection, workspaceId);
  return found.tools.map(toolToAction);
}
