/**
 * check:http — spec/27's SSRF guard and retry mapping, plus the spec/25 vault,
 * redactor and stable cache-key helpers, as a runnable script.
 *
 *   npm run check:http
 *
 * Needs no running server or database: it starts its own throwaway HTTP server
 * on an ephemeral 127.0.0.1 port. Because that's a private address, the checks
 * that must *reach* it pass `allowPrivateNetworks: true` (or the per-hop test
 * hook) explicitly — which is itself the proof that the default blocks it.
 */
import http from 'node:http';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  safeRequest, SsrfBlockedError, RequestTimeoutError, NetworkError, RequestError,
  classifyFailure, isRetryableHttpStatus, retryAfterMs, isBlockedAddress, hostAllowed, MAX_TIMEOUT_MS,
} from '../net/safeRequest.js';
import { encrypt, decrypt, hintFor, VaultError, connectionAad } from '../secrets/vault.js';
import { buildRedactor, redactKnownSecretFields, MASK } from '../secrets/redact.js';
import { stableStringify } from '../utils/stableStringify.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

async function rejectsWith(promise, ErrorClass) {
  try {
    await promise;
    return { ok: false, detail: 'resolved' };
  } catch (err) {
    return { ok: err instanceof ErrorClass, err, detail: `${err.name}: ${err.message}` };
  }
}

// ---------------------------------------------------------------- test server
let port;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  if (u.pathname === '/json') return send(200, { hello: 'world' });
  if (u.pathname === '/text') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('plain text'); }
  if (u.pathname === '/slow') { setTimeout(() => send(200, { slow: true }), Number(u.searchParams.get('ms')) || 2000); return undefined; }
  if (u.pathname === '/big') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('x'.repeat(1_500_000)); }
  if (u.pathname === '/redirect-private') return send(302, '', { Location: `http://localhost:${port}/json` });
  if (u.pathname === '/redirect-loop') return send(302, '', { Location: '/redirect-loop' });
  if (u.pathname === '/redirect-303') return send(303, '', { Location: '/echo' });
  if (u.pathname === '/500') return send(500, { error: 'boom' });
  if (u.pathname === '/429') return send(429, { error: 'slow down' }, { 'Retry-After': '2' });
  if (u.pathname === '/404') return send(404, { error: 'nope' });
  if (u.pathname === '/cookie') return send(200, { ok: true }, { 'Set-Cookie': 'session=abc', 'X-Ratelimit-Remaining': '9' });
  if (u.pathname === '/echo') {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => send(200, { method: req.method, contentType: req.headers['content-type'] || null, ua: req.headers['user-agent'], body: data }));
    return undefined;
  }
  return send(404, { error: 'unknown test route' });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
port = server.address().port;
const local = (p) => `http://127.0.0.1:${port}${p}`;
const open = { allowPrivateNetworks: true };

console.log(`http check · test server on 127.0.0.1:${port}\n`);

// ---------------------------------------------------------------- A: blocked by default
console.log('A. private and reserved destinations are blocked by default');
for (const url of [
  local('/json'),
  `http://localhost:${port}/json`,
  `http://[::1]:${port}/json`,
  `http://[::ffff:127.0.0.1]:${port}/json`,
  'http://10.0.0.1/',
  'http://10.0.0.5/',
  'http://169.254.169.254/latest/meta-data/',
  'http://2130706433/',
  'http://0x7f.1/',
  'http://192.168.1.1/',
  'http://172.16.0.1/',
  'http://100.64.0.1/',
  'http://0.0.0.0/',
  'http://[fd00::1]/',
  'http://[fe80::1]/',
]) {
  const r = await rejectsWith(safeRequest({ url, timeoutMs: 2000 }), SsrfBlockedError);
  check(`blocks ${url}`, r.ok, r.ok ? '' : r.detail);
}
{
  let resolvesLocal = false;
  try { resolvesLocal = (await dns.lookup('localtest.me', { all: true })).some((a) => a.address === '127.0.0.1'); } catch { /* offline */ }
  if (resolvesLocal) {
    const r = await rejectsWith(safeRequest({ url: `http://localtest.me:${port}/json` }), SsrfBlockedError);
    check('blocks a public hostname that resolves to 127.0.0.1 (localtest.me)', r.ok, r.detail);
  } else {
    console.log('  - skipped: localtest.me does not resolve to 127.0.0.1 here (offline?)');
  }
}

// ---------------------------------------------------------------- B: schemes and URL shapes
console.log('\nB. only http(s), no embedded credentials');
for (const url of ['ftp://example.com/file', 'file:///etc/passwd', 'gopher://example.com/', 'http://user:pass@example.com/', 'not a url']) {
  const r = await rejectsWith(safeRequest({ url }), SsrfBlockedError);
  check(`rejects ${url}`, r.ok, r.ok ? '' : r.detail);
}
check('address classifier: 8.8.8.8 is allowed', !isBlockedAddress('8.8.8.8'));
check('address classifier: 2606:4700:4700::1111 is allowed', !isBlockedAddress('2606:4700:4700::1111'));
check('address classifier: ::ffff:7f00:1 (hex-mapped loopback) is blocked', isBlockedAddress('::ffff:7f00:1'));
check('address classifier: ::ffff:8.8.8.8 is allowed', !isBlockedAddress('::ffff:8.8.8.8'));
check('address classifier: 239.1.1.1 (multicast) and 250.1.1.1 (reserved) are blocked', isBlockedAddress('239.1.1.1') && isBlockedAddress('250.1.1.1'));

// ---------------------------------------------------------------- C: dev flag allows local
console.log('\nC. allowPrivateNetworks reaches a local server');
{
  const res = await safeRequest({ url: local('/json'), ...open });
  check('GET /json → 200, ok', res.status === 200 && res.ok === true);
  check('JSON body is parsed', res.body?.hello === 'world');
  check('text is always the raw body', res.text === '{"hello":"world"}');
  check('headers are lowercased', res.headers['content-type'] === 'application/json');
  check('durationMs and final url are reported', typeof res.durationMs === 'number' && res.url === local('/json'));
  const text = await safeRequest({ url: local('/text'), ...open });
  check('non-JSON content type → body is text', text.body === 'plain text');
  const cookie = await safeRequest({ url: local('/cookie'), ...open });
  check('Set-Cookie is dropped, rate-limit headers kept', !('set-cookie' in cookie.headers) && cookie.headers['x-ratelimit-remaining'] === '9');
  const lh = await safeRequest({ url: `http://localhost:${port}/json`, ...open });
  check('hostname lookup path works when allowed', lh.status === 200);
}

// ---------------------------------------------------------------- D: redirects
console.log('\nD. redirects are re-checked on every hop');
{
  const firstHopOnly = (hostname, hop) => hop === 0;
  const r = await rejectsWith(safeRequest({ url: local('/redirect-private'), _testAllowPrivate: firstHopOnly }), SsrfBlockedError);
  check('a redirect to localhost is blocked on hop 1', r.ok && r.err.hop === 1, r.detail);
  const followed = await safeRequest({ url: local('/redirect-private'), ...open });
  check('with private allowed, the redirect is followed to the final URL', followed.status === 200 && followed.url === `http://localhost:${port}/json` && followed.redirects.length === 1);
  const loop = await rejectsWith(safeRequest({ url: local('/redirect-loop'), ...open }), RequestError);
  check('a redirect loop stops after maxRedirects', loop.ok, loop.detail);
  const see = await safeRequest({ url: local('/redirect-303'), method: 'POST', body: { a: 1 }, ...open });
  check('303 turns a POST into a bodiless GET', see.body?.method === 'GET' && see.body?.body === '');
}

// ---------------------------------------------------------------- E: limits
console.log('\nE. size cap and timeout');
{
  const big = await safeRequest({ url: local('/big'), ...open });
  check('a 1.5 MB body is truncated at 1 MB, not an error', big.truncated === true && big.text.length === 1_048_576);
  const small = await safeRequest({ url: local('/big'), maxBytes: 1000, ...open });
  check('maxBytes is configurable', small.truncated && small.text.length === 1000);
  const t0 = Date.now();
  const slow = await rejectsWith(safeRequest({ url: local('/slow?ms=2000'), timeoutMs: 300, ...open }), RequestTimeoutError);
  check('timeoutMs fires', slow.ok && Date.now() - t0 < 1500, slow.detail);
  check('a timeout after connecting is marked as sent', slow.err?.sentRequest === true);
  check(`timeout is capped at ${MAX_TIMEOUT_MS} ms`, MAX_TIMEOUT_MS === 30_000);
}

// ---------------------------------------------------------------- F: request bodies & statuses
console.log('\nF. bodies and status handling');
{
  const echo = await safeRequest({ url: local('/echo'), method: 'POST', body: { order: 42 }, ...open });
  check('object bodies are sent as JSON', echo.body?.contentType === 'application/json' && echo.body?.body === '{"order":42}');
  check('User-Agent identifies AgentFlow', /^AgentFlow\/1\.0/.test(echo.body?.ua || ''));
  const e500 = await safeRequest({ url: local('/500'), ...open });
  check('5xx is returned, not thrown', e500.status === 500 && e500.ok === false);
  const e429 = await safeRequest({ url: local('/429'), ...open });
  check('429 exposes Retry-After (2 s)', e429.status === 429 && retryAfterMs(e429.headers) === 2000);
  const refused = await rejectsWith(safeRequest({ url: 'http://127.0.0.1:1/', method: 'POST', ...open }), NetworkError);
  check('a refused connection is a NetworkError, not sent', refused.ok && refused.err.sentRequest === false, refused.detail);
  check('…which is retryable even for POST', classifyFailure({ method: 'POST', error: refused.err }) === 'retryable');
}

// ---------------------------------------------------------------- G: retry mapping
console.log('\nG. classifyFailure matrix');
{
  const timeoutSent = new RequestTimeoutError(100, { sentRequest: true });
  const cases = [
    [{ method: 'GET', status: 503 }, 'retryable'],
    [{ method: 'POST', status: 503 }, 'permanent'],
    [{ method: 'PATCH', status: 502 }, 'permanent'],
    [{ method: 'PUT', status: 500 }, 'retryable'],
    [{ method: 'DELETE', status: 504 }, 'retryable'],
    [{ method: 'POST', status: 429 }, 'retryable'],
    [{ method: 'GET', status: 404 }, 'permanent'],
    [{ method: 'GET', status: 400 }, 'permanent'],
    [{ method: 'GET', status: 200 }, null],
    [{ method: 'GET', error: timeoutSent }, 'retryable'],
    [{ method: 'POST', error: timeoutSent }, 'permanent'],
    [{ method: 'PATCH', error: timeoutSent }, 'permanent'],
    [{ method: 'POST', error: new NetworkError('reset', { sentRequest: true }) }, 'permanent'],
    [{ method: 'POST', error: new NetworkError('ENOTFOUND', { sentRequest: false }) }, 'retryable'],
    [{ method: 'GET', error: new SsrfBlockedError('blocked') }, 'permanent'],
  ];
  for (const [input, expected] of cases) {
    const label = `${input.method} ${input.status ?? input.error?.name}${input.error?.sentRequest === false ? ' (unsent)' : ''}`;
    check(`${label} → ${expected}`, classifyFailure(input) === expected);
  }
  check('isRetryableHttpStatus: 429 and 5xx only', isRetryableHttpStatus(429) && isRetryableHttpStatus(503) && !isRetryableHttpStatus(404));
}

// ---------------------------------------------------------------- H: allowlist
console.log('\nH. HTTP_TOOL_ALLOWED_HOSTS');
{
  check('*.example.com matches subdomains', hostAllowed('api.example.com', ['*.example.com']));
  check('*.example.com does not match lookalikes', !hostAllowed('evilexample.com', ['*.example.com']));
  check('exact entries match exactly', hostAllowed('api.test', ['api.test']) && !hostAllowed('x.api.test', ['api.test']));
  const r = await rejectsWith(safeRequest({ url: 'http://evil.example.org/', allowedHosts: ['*.example.com'] }), SsrfBlockedError);
  check('a host outside the allowlist is refused before any lookup', r.ok, r.detail);
  const byIp = await rejectsWith(safeRequest({ url: local('/json'), allowedHosts: ['localhost'], ...open }), SsrfBlockedError);
  check('the allowlist applies to IP literals too', byIp.ok);
  const ok = await safeRequest({ url: `http://localhost:${port}/json`, allowedHosts: ['localhost'], ...open });
  check('an allowlisted host is reached', ok.status === 200);
}

// ---------------------------------------------------------------- I: vault
console.log('\nI. vault (AES-256-GCM, AAD-bound)');
{
  const aad = connectionAad('ws1', 'conn1');
  const secret = { token: 'xoxb-1234567890-abcdef', teamId: 'T1' };
  const blob = encrypt(secret, aad);
  check('round-trips', JSON.stringify(decrypt(blob, aad)) === JSON.stringify(secret));
  check('ciphertext does not contain the plaintext', !Buffer.from(blob.ciphertext, 'base64').toString('utf8').includes('xoxb'));
  check('a fresh IV every time', encrypt(secret, aad).iv !== blob.iv);
  let wrongAad = false;
  try { decrypt(blob, connectionAad('ws2', 'conn1')); } catch (e) { wrongAad = e instanceof VaultError; }
  check('another workspace\'s AAD fails to decrypt', wrongAad);
  let wrongConn = false;
  try { decrypt(blob, connectionAad('ws1', 'conn2')); } catch (e) { wrongConn = e instanceof VaultError; }
  check('another connection\'s AAD fails to decrypt', wrongConn);
  const tampered = { ...blob, ciphertext: Buffer.from(Buffer.from(blob.ciphertext, 'base64').map((b, i) => (i === 0 ? b ^ 1 : b))).toString('base64') };
  let tamperFails = false;
  try { decrypt(tampered, aad); } catch (e) { tamperFails = e instanceof VaultError; }
  check('a flipped ciphertext bit fails', tamperFails);
  let tagFails = false;
  try { decrypt({ ...blob, tag: Buffer.alloc(16).toString('base64') }, aad); } catch (e) { tagFails = e instanceof VaultError; }
  check('a forged tag fails', tagFails);
  check('hintFor masks long values to the last 4', hintFor('xoxb-1234567890-abcdef') === '••••cdef');
  check('hintFor fully masks short values', hintFor('abc123') === '••••');
}

// ---------------------------------------------------------------- J: redaction
console.log('\nJ. redaction');
{
  const redact = buildRedactor(['sk_live_SECRET123', 'abc', 42]);
  const input = {
    log: 'called with sk_live_SECRET123 ok',
    nested: [{ echo: 'Bearer sk_live_SECRET123' }, 'abc stays'],
    headers: { Authorization: 'Bearer anything', 'X-API-Key': 'k', Cookie: 'c=1', Accept: 'json' },
    n: 42,
  };
  const out = redact(input);
  check('secrets are masked in strings at any depth', out.log === `called with ${MASK} ok` && out.nested[0].echo === `Bearer ${MASK}`);
  check('values shorter than 4 characters are not treated as secrets', out.nested[1] === 'abc stays');
  check('Authorization / X-API-Key / Cookie headers are scrubbed', out.headers.Authorization === MASK && out.headers['X-API-Key'] === MASK && out.headers.Cookie === MASK && out.headers.Accept === 'json');
  check('numbers pass through untouched', out.n === 42);
  check('the input is not mutated', input.log.includes('SECRET123') && input.headers.Authorization === 'Bearer anything');
  const err = redact(new Error('401 for token sk_live_SECRET123'));
  check('error messages are scrubbed', err instanceof Error && err.message === `401 for token ${MASK}`);
  check('an empty redactor reports isEmpty', buildRedactor([]).isEmpty === true);

  const fields = redactKnownSecretFields(
    { name: 'Slack', botToken: 'xoxb-1', password: 'hunter2', apiKey: 'k', webhookUrl: 'https://hooks.slack.com/x', note: 'ghp_abcdefghijklmnop', nested: { secret: 's', ok: 'fine' } },
    ['webhookUrl'],
  );
  check('secret-named keys are redacted', fields.botToken === '[redacted]' && fields.password === '[redacted]' && fields.apiKey === '[redacted]' && fields.nested.secret === '[redacted]');
  check('schema secret keys are redacted', fields.webhookUrl === '[redacted]');
  check('token-looking values are redacted wherever they are', fields.note === '[redacted]');
  check('ordinary fields survive', fields.name === 'Slack' && fields.nested.ok === 'fine');
}

// ---------------------------------------------------------------- K: stable JSON
console.log('\nK. stableStringify');
{
  check('key order does not matter', stableStringify({ b: 1, a: { d: 2, c: 3 } }) === stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  check('output is sorted JSON', stableStringify({ b: 1, a: [2, { z: 1, y: 2 }] }) === '{"a":[2,{"y":2,"z":1}],"b":1}');
  check('undefined is dropped from objects and null in arrays, like JSON', stableStringify({ a: undefined, b: [undefined] }) === '{"b":[null]}');
  check('Dates use toJSON', stableStringify({ at: new Date(0) }) === '{"at":"1970-01-01T00:00:00.000Z"}');
  let circular = false;
  try { const o = {}; o.self = o; stableStringify(o); } catch (e) { circular = e instanceof TypeError; }
  check('cycles throw', circular);
}

// ---------------------------------------------------------------- L: static scan
console.log('\nL. static scan: safeRequest is the only way out');
{
  const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'scripts') walk(full); // check scripts are test harnesses calling the local API
      } else if (/\.(m?js)$/.test(entry.name)) files.push(full);
    }
  };
  walk(srcRoot);
  const violations = [];
  for (const file of files) {
    const rel = path.relative(srcRoot, file);
    if (rel === path.join('net', 'safeRequest.js')) continue;
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    const importsHttp = /from\s+['"](node:)?https?['"]|require\(['"](node:)?https?['"]\)/.test(text);
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (/\bfetch\s*\(/.test(line)) violations.push(`${rel}:${i + 1} calls fetch()`);
      if (/['"]undici['"]/.test(line)) violations.push(`${rel}:${i + 1} imports undici`);
      if (importsHttp && /\bhttps?\.(request|get)\s*\(/.test(line)) violations.push(`${rel}:${i + 1} makes an http(s) request directly`);
    });
    // index.js is allowed to import node:http, but only to create the API server.
    if (importsHttp && !/\.createServer\(/.test(text)) violations.push(`${rel} imports http/https without creating a server`);
  }
  check(`no outbound HTTP outside net/safeRequest.js (${files.length} files scanned)`, violations.length === 0, violations.join('; '));
}

server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
