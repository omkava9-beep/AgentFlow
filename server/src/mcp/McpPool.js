import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { safeRequest, SsrfBlockedError, RequestError } from '../net/safeRequest.js';
import { PermanentFailure } from '../queue/errors.js';
import { stableStringify } from '../utils/stableStringify.js';
import { getAllowlistEntry, buildSpawnEnv, SERVER_ROOT } from './allowlist.js';

/**
 * One MCP client per connection (spec/37 §2) - an in-process singleton, like
 * the queue and the cache.
 *
 * - Lazy: the first listTools/callTool connects and runs `initialize`;
 *   concurrent first calls share one connect promise.
 * - Idle close after MCP_IDLE_CLOSE_MS (5 min): the stdio child is killed, the
 *   HTTP session closed.
 * - Reconnect with backoff (1 s, 2 s, 4 s … 30 s) after a transport error or a
 *   stdio exit. A call during backoff fails *retryable*, so the queue's own
 *   retry covers it.
 * - A connection edited since its client was opened (different fingerprint)
 *   gets a fresh client; deleting one calls `close(id)`.
 *
 * @modelcontextprotocol/sdk is imported on first use, the way LLMAgentProvider
 * loads @anthropic-ai/sdk: a process that never touches MCP never loads it.
 */

let sdkPromise = null;
function loadSdk() {
  sdkPromise ??= Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js'),
    import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
    import('@modelcontextprotocol/sdk/types.js'),
  ]).then(([client, stdio, http, types]) => ({
    Client: client.Client,
    StdioClientTransport: stdio.StdioClientTransport,
    StreamableHTTPClientTransport: http.StreamableHTTPClientTransport,
    ToolListChangedNotificationSchema: types.ToolListChangedNotificationSchema,
    McpError: types.McpError,
    ErrorCode: types.ErrorCode,
  }));
  return sdkPromise;
}

/** True once the SDK has been imported - for the "not loaded unless used" check. */
export const isSdkLoaded = () => sdkPromise !== null;

const MAX_BACKOFF_MS = 30_000;
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/** Retryable by construction: the queue retries anything not marked permanent. */
export class McpUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'McpUnavailableError';
    this.retryable = true;
  }
}

/**
 * A `fetch` for the SDK's Streamable HTTP transport, built on safeRequest so the
 * SSRF guard (connect-time IP check, per-hop redirect re-check, size cap)
 * applies to MCP exactly as to the HTTP tool (spec/37 §1, C3).
 *
 * The optional standalone GET SSE stream (server-initiated notifications) is
 * answered with 405 - the spec allows servers not to offer it, and the SDK
 * treats 405 as "not supported". safeRequest buffers bodies, so a stream that
 * never ends would just time out. POST responses that arrive as SSE are fine:
 * the server ends that stream once the response is written.
 */
function makeSafeFetch({ timeoutMs, allowPrivateNetworks }) {
  return async function safeFetch(url, init = {}) {
    const method = String(init.method || 'GET').toUpperCase();
    const headers = Object.fromEntries(new Headers(init.headers || {}).entries());
    if (method === 'GET' && /text\/event-stream/.test(headers.accept || '')) {
      return new Response(null, { status: 405, statusText: 'Method Not Allowed' });
    }
    const res = await safeRequest({
      url: String(url),
      method,
      headers,
      body: typeof init.body === 'string' ? init.body : init.body ?? undefined,
      timeoutMs,
      maxRedirects: 3,
      keepHeaders: ['mcp-session-id', 'mcp-protocol-version', 'www-authenticate'],
      ...(allowPrivateNetworks !== undefined && { allowPrivateNetworks }),
    });
    const body = NULL_BODY_STATUSES.has(res.status) ? null : res.text ?? '';
    return new Response(body, { status: res.status, headers: res.headers });
  };
}

function fingerprintOf(connection, workspaceId) {
  const { transport, url, headerName, allowlistId } = connection.config || {};
  // Hashed in memory only; nothing is stored.
  return crypto.createHash('sha256')
    .update(stableStringify({ transport, url, headerName, allowlistId, credentials: connection.credentials || {}, workspaceId: String(workspaceId || '') }))
    .digest('hex');
}

/** Walks `cause` chains: the SDK wraps transport errors. */
function rootCause(err) {
  let e = err;
  for (let i = 0; i < 5 && e; i += 1) {
    if (e instanceof SsrfBlockedError || e instanceof RequestError || e?.permanent) return e;
    e = e.cause;
  }
  return null;
}

class McpPool {
  constructor() {
    this.entries = new Map(); // connectionId -> entry
    // Test seam: check scripts override network policy for their own local servers.
    this.testOptions = {};
  }

  /** The live entry for a connection, replacing a stale one (edited connection). */
  #entryFor(connection, workspaceId) {
    const id = String(connection.id);
    const fingerprint = fingerprintOf(connection, workspaceId);
    let entry = this.entries.get(id);
    if (entry && entry.fingerprint !== fingerprint) {
      this.#teardown(entry);
      entry = null;
    }
    if (!entry) {
      entry = { id, fingerprint, connection, workspaceId, client: null, transport: null, connecting: null, failures: 0, backoffUntil: 0, idleTimer: null, onToolsChanged: new Set() };
      this.entries.set(id, entry);
    }
    entry.connection = connection;
    return entry;
  }

  #teardown(entry) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
    const { client } = entry;
    entry.client = null;
    entry.transport = null;
    entry.connecting = null;
    if (client) client.close().catch(() => {});
  }

  #touch(entry) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => this.#teardown(entry), env.mcpIdleCloseMs);
    entry.idleTimer.unref?.();
  }

  async #transportFor(entry, sdk) {
    const { config = {}, credentials = {} } = entry.connection;
    if (config.transport === 'stdio') {
      const allow = getAllowlistEntry(config.allowlistId);
      if (!allow) throw new PermanentFailure(`MCP server "${config.allowlistId}" is no longer allowlisted`);
      return new sdk.StdioClientTransport({
        command: allow.command,
        args: allow.args || [],
        env: buildSpawnEnv(allow, { workspaceId: entry.workspaceId }),
        cwd: SERVER_ROOT,
        stderr: 'pipe',
      });
    }
    if (config.transport === 'http') {
      if (!config.url) throw new PermanentFailure('MCP connection has no server URL');
      let url;
      try {
        url = new URL(config.url);
      } catch {
        throw new PermanentFailure(`MCP server URL is not valid: ${config.url}`);
      }
      const headers = {};
      if (credentials.authHeader) headers[config.headerName || 'Authorization'] = credentials.authHeader;
      return new sdk.StreamableHTTPClientTransport(url, {
        fetch: makeSafeFetch({ timeoutMs: env.mcpCallTimeoutMs, allowPrivateNetworks: this.testOptions.allowPrivateNetworks }),
        requestInit: { headers },
      });
    }
    throw new PermanentFailure(`Unknown MCP transport: ${config.transport}`);
  }

  async #connect(entry) {
    if (entry.client) return entry.client;
    if (entry.connecting) return entry.connecting;
    if (Date.now() < entry.backoffUntil) {
      throw new McpUnavailableError(`MCP server "${entry.connection.name}" is reconnecting - retry in ${Math.ceil((entry.backoffUntil - Date.now()) / 1000)}s`);
    }
    entry.connecting = (async () => {
      const sdk = await loadSdk();
      const transport = await this.#transportFor(entry, sdk);
      const client = new sdk.Client({ name: 'agentflow', version: '1.0.0' }, { capabilities: {} });
      client.setNotificationHandler(sdk.ToolListChangedNotificationSchema, () => {
        for (const fn of entry.onToolsChanged) fn(entry.id);
      });
      const lost = () => {
        // Unexpected close (stdio exit, dropped session): back off before the
        // next connect, and let in-flight calls fail retryable.
        if (entry.client === client) {
          entry.client = null;
          entry.transport = null;
          entry.failures += 1;
          entry.backoffUntil = Date.now() + Math.min(1000 * 2 ** (entry.failures - 1), MAX_BACKOFF_MS);
        }
      };
      client.onclose = lost;
      try {
        await client.connect(transport, { timeout: env.mcpCallTimeoutMs });
      } catch (err) {
        client.close().catch(() => {});
        const permanent = rootCause(err);
        if (permanent) throw permanent instanceof SsrfBlockedError ? new PermanentFailure(`MCP server blocked by network policy: ${permanent.message}`) : permanent;
        entry.failures += 1;
        entry.backoffUntil = Date.now() + Math.min(1000 * 2 ** (entry.failures - 1), MAX_BACKOFF_MS);
        throw new McpUnavailableError(`Could not connect to MCP server "${entry.connection.name}": ${err.message}`);
      }
      entry.client = client;
      entry.transport = transport;
      entry.failures = 0;
      entry.backoffUntil = 0;
      entry.serverInfo = client.getServerVersion() || null;
      return client;
    })();
    try {
      return await entry.connecting;
    } finally {
      entry.connecting = null;
    }
  }

  /** Maps SDK/transport errors onto the queue's two outcomes (spec/07). */
  async #classify(err, sdk, what) {
    const permanent = rootCause(err);
    if (permanent) {
      return permanent instanceof SsrfBlockedError
        ? new PermanentFailure(`MCP server blocked by network policy: ${permanent.message}`)
        : permanent;
    }
    if (err instanceof McpUnavailableError) return err;
    if (err instanceof sdk.McpError) {
      // Timeouts and a closed connection are worth retrying; a protocol-level
      // refusal (unknown tool, invalid params) will fail the same way again.
      if ([sdk.ErrorCode.RequestTimeout, sdk.ErrorCode.ConnectionClosed].includes(err.code)) {
        return new McpUnavailableError(`${what}: ${err.message}`);
      }
      return new PermanentFailure(`${what}: ${err.message}`);
    }
    return new McpUnavailableError(`${what}: ${err?.message || err}`);
  }

  /** → { tools, serverInfo } */
  async listTools(connection, workspaceId) {
    const entry = this.#entryFor(connection, workspaceId);
    const sdk = await loadSdk();
    try {
      const client = await this.#connect(entry);
      this.#touch(entry);
      const tools = [];
      let cursor;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: env.mcpCallTimeoutMs });
        tools.push(...(page.tools || []));
        cursor = page.nextCursor;
      } while (cursor && tools.length < 500);
      return { tools, serverInfo: entry.serverInfo || client.getServerVersion() || null };
    } catch (err) {
      throw await this.#classify(err, sdk, `tools/list on "${connection.name}"`);
    }
  }

  /**
   * One tools/call. `signal` (an AbortSignal) cancels it - the SDK sends
   * `notifications/cancelled` - and the timeout does the same at
   * MCP_CALL_TIMEOUT_MS. `runId` rides in `_meta` for the server's attribution.
   */
  async callTool(connection, workspaceId, { name, args = {}, runId = null, signal, timeoutMs = env.mcpCallTimeoutMs }) {
    const entry = this.#entryFor(connection, workspaceId);
    const sdk = await loadSdk();
    try {
      const client = await this.#connect(entry);
      this.#touch(entry);
      return await client.callTool(
        { name, arguments: args, _meta: runId ? { 'agentflow/runId': String(runId) } : undefined },
        undefined,
        { timeout: timeoutMs, ...(signal && { signal }) },
      );
    } catch (err) {
      if (signal?.aborted) {
        const cancelled = new Error('MCP call cancelled');
        cancelled.cancelled = true;
        cancelled.permanent = true; // don't let the queue retry a cancelled call
        throw cancelled;
      }
      throw await this.#classify(err, sdk, `MCP tool "${name}"`);
    }
  }

  /** Called when a connection is edited or deleted: the stdio child is killed. */
  close(connectionId) {
    const entry = this.entries.get(String(connectionId));
    if (!entry) return false;
    this.#teardown(entry);
    this.entries.delete(String(connectionId));
    return true;
  }

  async closeAll() {
    for (const id of [...this.entries.keys()]) this.close(id);
  }

  /** Subscribe to `notifications/tools/list_changed` for a connection. */
  onToolsChanged(connectionId, fn) {
    const entry = this.entries.get(String(connectionId));
    if (entry) entry.onToolsChanged.add(fn);
  }

  /** For checks and the status page: what's open, never secrets. */
  describe(connectionId) {
    const entry = this.entries.get(String(connectionId));
    if (!entry) return null;
    return {
      connected: Boolean(entry.client),
      pid: entry.transport?.pid ?? null,
      failures: entry.failures,
      backoffUntil: entry.backoffUntil || null,
    };
  }

  /** Test seam: forget backoff so a check can reconnect immediately. */
  __resetBackoff(connectionId) {
    const entry = this.entries.get(String(connectionId));
    if (entry) { entry.backoffUntil = 0; }
  }
}

export const mcpPool = new McpPool();
