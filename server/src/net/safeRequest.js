import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { env } from '../config/env.js';

/**
 * The only outbound HTTP client in the server (spec/27, C3). Live integration
 * actions, connection tests, the RSS poller and remote MCP all go through here;
 * nothing else may import http/https for outbound traffic or call fetch.
 *
 * The SSRF guard checks the destination IP *inside the socket's own DNS lookup*,
 * so the address that was validated is the address that gets connected to — a
 * DNS answer that changes between "check" and "connect" can't slip past.
 * Redirects are followed by hand and every hop is checked from scratch.
 */

export const DEFAULTS = Object.freeze({ timeoutMs: 10_000, maxBytes: 1_048_576, maxRedirects: 3 });
export const MAX_TIMEOUT_MS = 30_000;
const IDEMPOTENT = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
// Response headers worth handing to an action. Set-Cookie is deliberately absent.
const KEPT_HEADERS = new Set([
  'content-type', 'content-length', 'location', 'retry-after', 'date', 'etag', 'last-modified',
  'cache-control', 'link', 'x-request-id', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset',
]);

// ---------------------------------------------------------------- errors

/** Blocked address, bad scheme or disallowed host. Never retried. */
export class SsrfBlockedError extends Error {
  constructor(message, { url, hop = 0 } = {}) {
    super(message);
    this.name = 'SsrfBlockedError';
    this.permanent = true;
    this.url = url;
    this.hop = hop;
  }
}

/** Anything that makes the request itself invalid (too many redirects, bad body). Never retried. */
export class RequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RequestError';
    this.permanent = true;
  }
}

/** The whole request, redirects included, exceeded its deadline. */
export class RequestTimeoutError extends Error {
  constructor(timeoutMs, { sentRequest = true } = {}) {
    super(`Request timed out after ${timeoutMs} ms`);
    this.name = 'RequestTimeoutError';
    this.retryable = true;
    this.sentRequest = sentRequest;
  }
}

/** DNS failure, refused or reset connection. `sentRequest` says whether the peer may have seen it. */
export class NetworkError extends Error {
  constructor(message, { code, sentRequest = false } = {}) {
    super(message);
    this.name = 'NetworkError';
    this.retryable = true;
    this.code = code;
    this.sentRequest = sentRequest;
  }
}

// ---------------------------------------------------------------- address checks

const blockList = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 3], // 224/4 multicast and everything above it
]) blockList.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) blockList.addSubnet(addr, prefix, 'ipv6');
blockList.addAddress('::', 'ipv6');
blockList.addAddress('::1', 'ipv6');

/** Expands an IPv6 string to eight 16-bit numbers, or null if it isn't one. */
function ipv6Hextets(address) {
  let a = address.toLowerCase().split('%')[0];
  const v4Tail = a.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Tail) {
    const [p, q, r, s] = v4Tail[1].split('.').map(Number);
    a = a.slice(0, -v4Tail[1].length) + `${((p << 8) | q).toString(16)}:${((r << 8) | s).toString(16)}`;
  }
  const [head, tail] = a.includes('::') ? a.split('::') : [a, null];
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const fill = tail === null ? 0 : 8 - headParts.length - tailParts.length;
  const parts = [...headParts, ...Array(Math.max(fill, 0)).fill('0'), ...tailParts];
  if (parts.length !== 8) return null;
  return parts.map((h) => parseInt(h || '0', 16));
}

/**
 * True for loopback, private, link-local, CGNAT, multicast/reserved, the
 * unspecified address, and IPv4-mapped/-compatible IPv6 forms of any of them.
 */
export function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return blockList.check(address, 'ipv4');
  if (family !== 6) return true; // not an IP at all: fail closed
  const h = ipv6Hextets(address);
  if (!h) return true;
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (deprecated compatible) carry an IPv4 address.
  if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || (h[5] === 0 && (h[6] || h[7])))) {
    const v4 = `${h[6] >> 8}.${h[6] & 255}.${h[7] >> 8}.${h[7] & 255}`;
    return blockList.check(v4, 'ipv4');
  }
  return blockList.check(address, 'ipv6');
}

/** `*.example.com` matches subdomains of example.com; anything else is an exact match. */
export function hostAllowed(hostname, allowedHosts) {
  if (!allowedHosts?.length) return true;
  const host = hostname.toLowerCase();
  return allowedHosts.some((pattern) => (pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern));
}

function parseDestination(rawUrl, hop, policy) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`Invalid URL: ${rawUrl}`, { url: rawUrl, hop });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError(`Only http and https URLs are allowed (got ${url.protocol})`, { url: url.href, hop });
  }
  if (url.username || url.password) {
    throw new SsrfBlockedError('URLs with embedded credentials are not allowed — use a connection', { url: url.href, hop });
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!hostAllowed(hostname, policy.allowedHosts)) {
    throw new SsrfBlockedError(`Host ${hostname} is not in HTTP_TOOL_ALLOWED_HOSTS`, { url: url.href, hop });
  }
  // IP literals skip `lookup` entirely, so they must be checked here.
  if (net.isIP(hostname) && isBlockedAddress(hostname) && !policy.privateAllowed(hostname, hop)) {
    throw new SsrfBlockedError(`Blocked destination ${hostname} (private or reserved address)`, { url: url.href, hop });
  }
  return { url, hostname };
}

/** A `lookup` for http.request that resolves every address and rejects if any is blocked. */
function guardedLookup(policy, hop, urlHref) {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { all: true, family: options?.family || 0 }, (err, addresses) => {
      if (err) return callback(err);
      if (!policy.privateAllowed(hostname, hop)) {
        const bad = addresses.find((a) => isBlockedAddress(a.address));
        if (bad) {
          return callback(new SsrfBlockedError(`Blocked destination ${hostname} → ${bad.address} (private or reserved address)`, { url: urlHref, hop }));
        }
      }
      if (options?.all) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

// ---------------------------------------------------------------- request

function encodeBody(body, headers) {
  if (body === undefined || body === null) return null;
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }
  return Buffer.from(JSON.stringify(body), 'utf8');
}

function pickHeaders(raw, extra = []) {
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const k = key.toLowerCase();
    if (KEPT_HEADERS.has(k) || extra.includes(k)) out[k] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

/** One hop: resolves with { status, headers, rawHeaders, text, truncated } or rejects. */
function requestOnce({ url, method, headers, payload, maxBytes, policy, hop, signal }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    let sentRequest = false;
    let settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; fn(value); } };

    const req = lib.request(url, {
      method,
      headers,
      agent: false, // no pooling, and no proxy env vars
      lookup: guardedLookup(policy, hop, url.href),
      rejectUnauthorized: true,
    });

    if (signal.aborted) {
      req.destroy();
      return finish(reject, signal.reason);
    }
    const onAbort = () => req.destroy(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });

    req.on('socket', (socket) => {
      socket.once(url.protocol === 'https:' ? 'secureConnect' : 'connect', () => { sentRequest = true; });
    });

    req.on('error', (err) => {
      signal.removeEventListener('abort', onAbort);
      if (err instanceof SsrfBlockedError) return finish(reject, err);
      if (err instanceof RequestTimeoutError) {
        err.sentRequest = sentRequest; // a timeout before connecting is as safe to retry as a refusal
        return finish(reject, err);
      }
      finish(reject, new NetworkError(`${err.code || 'Network error'}: ${err.message}`, { code: err.code, sentRequest }));
    });

    req.on('response', (res) => {
      const chunks = [];
      let size = 0;
      let truncated = false;
      res.on('data', (chunk) => {
        if (truncated) return;
        if (size + chunk.length > maxBytes) {
          chunks.push(chunk.subarray(0, maxBytes - size));
          size = maxBytes;
          truncated = true;
          res.destroy(); // stop reading; what we have is returned
          return;
        }
        chunks.push(chunk);
        size += chunk.length;
      });
      const done = () => {
        signal.removeEventListener('abort', onAbort);
        finish(resolve, {
          status: res.statusCode,
          rawHeaders: res.headers,
          text: Buffer.concat(chunks).toString('utf8'),
          truncated,
        });
      };
      res.on('end', done);
      res.on('close', () => { if (truncated) done(); });
      res.on('error', (err) => {
        if (truncated) return done();
        signal.removeEventListener('abort', onAbort);
        finish(reject, new NetworkError(`Response stream failed: ${err.message}`, { code: err.code, sentRequest: true }));
      });
    });

    if (payload) req.end(payload);
    else req.end();
  });
}

/**
 * safeRequest({ url, method, headers, body, timeoutMs, maxBytes, maxRedirects })
 *   → { status, ok, url, headers, body, text, truncated, durationMs, redirects }
 *
 * Non-2xx statuses are returned, not thrown — the caller decides (see
 * classifyFailure). Throws SsrfBlockedError, RequestError, RequestTimeoutError
 * or NetworkError.
 *
 * `allowPrivateNetworks` / `allowedHosts` override the env for one call (tests,
 * and the check script); `_testAllowPrivate(hostname, hop)` is a test-only hook
 * that allows private destinations per hop so the redirect re-check can be
 * exercised against a local server. Production callers never pass it.
 */
export async function safeRequest({
  url,
  method = 'GET',
  headers = {},
  body,
  timeoutMs = DEFAULTS.timeoutMs,
  maxBytes = DEFAULTS.maxBytes,
  maxRedirects = DEFAULTS.maxRedirects,
  allowPrivateNetworks = env.httpAllowPrivateNetworks,
  allowedHosts = env.httpAllowedHosts,
  // Extra response headers a protocol needs back (lowercase), e.g. MCP's
  // `mcp-session-id` (spec/37). Set-Cookie can't be requested this way.
  keepHeaders = [],
  _testAllowPrivate,
} = {}) {
  const started = Date.now();
  const deadline = Math.min(Math.max(Number(timeoutMs) || DEFAULTS.timeoutMs, 1), MAX_TIMEOUT_MS);
  const policy = {
    allowedHosts,
    privateAllowed: (hostname, hop) => Boolean(allowPrivateNetworks || _testAllowPrivate?.(hostname, hop)),
  };

  let currentMethod = String(method).toUpperCase();
  let currentHeaders = {
    'User-Agent': `AgentFlow/1.0 (+${env.publicBaseUrl})`,
    Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
    ...headers,
  };
  let payload = encodeBody(body, currentHeaders);
  let currentUrl = url;
  const redirects = [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new RequestTimeoutError(deadline)), deadline);

  try {
    for (let hop = 0; ; hop += 1) {
      const { url: parsed } = parseDestination(currentUrl, hop, policy);
      if (payload) currentHeaders['Content-Length'] = String(payload.length);
      else delete currentHeaders['Content-Length'];

      const res = await requestOnce({
        url: parsed, method: currentMethod, headers: currentHeaders, payload, maxBytes, policy, hop, signal: controller.signal,
      });

      const location = res.rawHeaders.location;
      if (REDIRECT_STATUSES.has(res.status) && location) {
        if (hop >= maxRedirects) throw new RequestError(`Too many redirects (more than ${maxRedirects})`);
        const next = new URL(location, parsed);
        if (parsed.protocol === 'https:' && next.protocol === 'http:') {
          throw new SsrfBlockedError(`Refused redirect from https to http (${next.href})`, { url: next.href, hop: hop + 1 });
        }
        // Credentials don't follow a redirect to a different origin.
        if (next.origin !== parsed.origin) {
          currentHeaders = Object.fromEntries(Object.entries(currentHeaders).filter(([k]) => !['authorization', 'cookie', 'x-api-key'].includes(k.toLowerCase())));
        }
        // 303 always becomes GET; 301/302 turn a POST into a GET, as browsers do. 307/308 keep both.
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && currentMethod === 'POST')) {
          currentMethod = currentMethod === 'HEAD' ? 'HEAD' : 'GET';
          payload = null;
          currentHeaders = Object.fromEntries(Object.entries(currentHeaders).filter(([k]) => k.toLowerCase() !== 'content-type'));
        }
        redirects.push({ status: res.status, from: parsed.href, to: next.href });
        currentUrl = next.href;
        continue;
      }

      const responseHeaders = pickHeaders(res.rawHeaders, keepHeaders.map((h) => String(h).toLowerCase()).filter((h) => h !== 'set-cookie'));
      let parsedBody = res.text;
      if (!res.truncated && /\bjson\b/i.test(responseHeaders['content-type'] || '')) {
        try { parsedBody = JSON.parse(res.text); } catch { /* not really JSON: keep text */ }
      }
      return {
        status: res.status,
        ok: res.status >= 200 && res.status < 300,
        url: parsed.href,
        headers: responseHeaders,
        body: parsedBody,
        text: res.text,
        truncated: res.truncated,
        durationMs: Date.now() - started,
        redirects,
      };
    }
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- retry mapping

export function isIdempotent(method) {
  return IDEMPOTENT.has(String(method || 'GET').toUpperCase());
}

export function isRetryableHttpStatus(status) {
  return status === 429 || status >= 500;
}

/**
 * spec/27's retry table: → 'permanent' | 'retryable', or null for a success.
 *  - SSRF blocks and invalid requests: permanent
 *  - failures before the request was sent (DNS, refused): retryable, any method
 *  - timeouts, 5xx, resets after sending: retryable only for idempotent methods
 *    (a POST may already have arrived — retrying could send a message twice)
 *  - 429: retryable, any method; other 4xx: permanent
 */
export function classifyFailure({ method = 'GET', status, error } = {}) {
  if (error) {
    if (error.permanent) return 'permanent';
    if ((error instanceof NetworkError || error instanceof RequestTimeoutError) && error.sentRequest === false) return 'retryable';
    if (error instanceof RequestTimeoutError || error instanceof NetworkError) {
      return isIdempotent(method) ? 'retryable' : 'permanent';
    }
    return 'permanent';
  }
  if (status === undefined || status === null || status < 400) return null;
  if (status === 429) return 'retryable';
  if (status >= 500) return isIdempotent(method) ? 'retryable' : 'permanent';
  return 'permanent';
}

/** Parses Retry-After (seconds or HTTP date) into ms, or null. */
export function retryAfterMs(headers = {}) {
  const raw = headers['retry-after'];
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}
