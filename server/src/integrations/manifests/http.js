import { defineIntegration, assertOk } from '../defineAction.js';
import { PermanentFailure } from '../../queue/errors.js';
import { MAX_TIMEOUT_MS } from '../../net/safeRequest.js';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Adds the connection's optional auth to the outgoing headers (spec/27 §2). */
function authHeaders(connection) {
  if (!connection || connection.id === 'sandbox') return {};
  const { scheme, headerName, username } = connection.config || {};
  const { token, password } = connection.credentials || {};
  if (scheme === 'bearer' && token) return { Authorization: `Bearer ${token}` };
  if (scheme === 'apiKey' && token) return { [headerName || 'X-API-Key']: token };
  if (scheme === 'basic' && (username || password)) {
    return { Authorization: `Basic ${Buffer.from(`${username || ''}:${password || ''}`).toString('base64')}` };
  }
  return {};
}

/** Sent as JSON when it parses as JSON, otherwise as text. */
function encodeBody(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export default defineIntegration({
  id: 'http',
  name: 'HTTP Request',
  icon: 'globe',
  category: 'web',
  description: 'Call any HTTP API. Live by default, behind the SSRF guard.',
  // 'none' means credentials are optional, not absent: a connection can add auth.
  auth: {
    type: 'none',
    fields: [
      {
        key: 'scheme', label: 'Auth scheme', type: 'select', default: 'bearer',
        options: [{ value: 'bearer', label: 'Bearer token' }, { value: 'apiKey', label: 'API key header' }, { value: 'basic', label: 'Basic auth' }],
      },
      { key: 'token', label: 'Token / API key', type: 'text', secret: true },
      { key: 'headerName', label: 'API key header', type: 'text', default: 'X-API-Key' },
      { key: 'username', label: 'Username (basic)', type: 'text' },
      { key: 'password', label: 'Password (basic)', type: 'text', secret: true },
    ],
  },
  actions: [
    {
      id: 'request',
      name: 'HTTP request',
      description: 'Make a real HTTP request. Private and internal addresses are blocked.',
      configSchema: [
        { key: 'url', label: 'URL', type: 'text', required: true, placeholder: 'https://api.example.com/things' },
        { key: 'method', label: 'Method', type: 'select', default: 'GET', options: METHODS.map((m) => ({ value: m, label: m })) },
        { key: 'headers', label: 'Headers (JSON)', type: 'json', placeholder: '{ "Accept": "application/json" }' },
        { key: 'body', label: 'Request body', type: 'textarea', placeholder: 'Supports {{input.field}}; sent as JSON when it parses' },
        { key: 'timeoutMs', label: 'Timeout (ms)', type: 'number', default: 10000 },
        { key: 'cacheGet', label: 'Cache GET responses', type: 'boolean', default: false },
      ],
      // Not a side effect by nature, but only cached when the node opts in and
      // the call is a GET (spec/27 §2).
      cacheable: (params) => params?.cacheGet === true && String(params?.method || 'GET').toUpperCase() === 'GET',
      outputSample: { status: 200, ok: true, url: 'https://api.example.com/things', method: 'GET', headers: { 'content-type': 'application/json' }, body: { items: [] }, truncated: false, durationMs: 142 },
      sandbox: async ({ params, input, sandbox, logs }) => {
        const method = String(params.method || 'GET').toUpperCase();
        await sandbox.insert('requests', { url: params.url, method, body: params.body ?? null });
        logs.push(`[http] sandbox ${method} ${params.url} (no real network call)`);
        return {
          simulated: true,
          status: 200,
          ok: true,
          url: params.url,
          method,
          headers: { 'content-type': 'application/json' },
          body: params.body || (input ? { echo: input } : null),
          truncated: false,
          durationMs: 0,
        };
      },
      live: async ({ params, connection, http, logs }) => {
        const method = String(params.method || 'GET').toUpperCase();
        if (!METHODS.includes(method)) throw new PermanentFailure(`Unsupported HTTP method ${method}`);
        if (params.headers !== undefined && (typeof params.headers !== 'object' || Array.isArray(params.headers))) {
          throw new PermanentFailure('Headers must be a JSON object');
        }
        const timeoutMs = Math.min(Math.max(Number(params.timeoutMs) || 10_000, 1), MAX_TIMEOUT_MS);
        const response = await http({
          url: params.url,
          method,
          headers: { ...(params.headers || {}), ...authHeaders(connection) },
          body: method === 'GET' ? undefined : encodeBody(params.body),
          timeoutMs,
        });
        logs.push(`[http] ${method} ${response.url} -> ${response.status} in ${response.durationMs}ms${response.truncated ? ' (body truncated at 1 MB)' : ''}`);
        assertOk(response, { method });
        return {
          status: response.status,
          ok: response.ok,
          url: response.url,
          method,
          headers: response.headers,
          body: response.body,
          truncated: response.truncated,
          durationMs: response.durationMs,
        };
      },
    },
  ],
});
