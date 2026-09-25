/**
 * Integrations check for spec/25 (secrets & connections) and spec/26 (the
 * integration framework) - the acceptance criteria as a runnable script.
 *
 *   PORT=4500 MONGODB_URI=...-check INTEGRATIONS_LIVE=false npm run dev             # terminal 1
 *   BASE=http://localhost:4500/api MONGODB_URI=... npm run check:integrations       # terminal 2
 *
 * Sections A-G run against BASE, which is expected to be started with
 * INTEGRATIONS_LIVE=false so every result is deterministic. Section H starts a
 * second, private server with INTEGRATIONS_LIVE=true (and private networks
 * allowed, so it can reach a local echo server) to exercise the live path and
 * redaction end to end; it's killed and its database dropped on the way out.
 *
 * The server modules are imported directly where a unit-level check is sharper
 * than an HTTP one (manifests, the mode rule, legacy normalisation, cache keys,
 * resolveConnection). Their exact file names differ between the specs and the
 * implementation notes, so `firstModule()` probes the known candidates.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import mongoose from 'mongoose';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(HERE, '../..');
const B = process.env.BASE || 'http://localhost:4500/api';
const DB_URI = process.env.MONGODB_URI;
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`); ok ? pass++ : fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok2xx = (s) => s >= 200 && s < 300;
const brief = (v, n = 300) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? `${s.slice(0, n)}…` : s; };

if (!DB_URI) {
  console.error('MONGODB_URI must be set to the running server\'s database');
  process.exit(1);
}

// ------------------------------------------------------------------ module probing
async function firstModule(candidates) {
  for (const rel of candidates) {
    const abs = path.resolve(HERE, rel);
    if (fs.existsSync(abs)) return { mod: await import(pathToFileURL(abs).href), file: rel };
  }
  return { mod: null, file: null };
}
const pick = (mod, names) => {
  if (!mod) return null;
  for (const n of names) if (typeof mod[n] === 'function' || (mod[n] && typeof mod[n] === 'object')) return mod[n];
  return null;
};

// ------------------------------------------------------------------ HTTP helpers
function client(base) {
  return async function req(method, p, { body, token, ws } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    if (ws) headers['X-Workspace-Id'] = String(ws);
    const res = await fetch(base + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    return { status: res.status, body: json, text };
  };
}
const req = client(B);

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const newEmail = (tag) => `${tag}${uniq()}@integrations.dev`;
async function register(r, tag, email = newEmail(tag)) {
  const res = await r('POST', '/auth/register', { body: { email, password: 'password123', name: tag } });
  return { token: res.body?.token, user: res.body?.user, email, ws: res.body?.workspaces?.[0]?.id };
}
async function join(owner, ws, role) {
  const email = newEmail(role);
  const inv = await req('POST', `/workspaces/${ws}/invitations`, { body: { email, role }, token: owner.token });
  const token = String(inv.body?.inviteUrl || '').split('/invite/').pop();
  const u = await register(req, role, email);
  await req('POST', `/invitations/${token}/accept`, { token: u.token });
  return u;
}

const N = (id, type, config = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { config: { label: id, ...config } } });
const E = (source, target) => ({ id: `e-${source}-${target}`, source, target });
const toolNode = (id, integration, action, { connectionId = null, params = {}, mockOverrides = { failureRate: 0, latencyMs: [20, 40] } } = {}) =>
  N(id, 'tool', { integration, action, connectionId, params, mockOverrides });
const chain = (...middle) => ({
  nodes: [N('s', 'start'), ...middle, N('e', 'end')],
  edges: ['s', ...middle.map((m) => m.id)].map((src, i, all) => E(src, all[i + 1] ?? 'e')),
});

async function makeWorkflow(r, u, ws, name, graph) {
  const c = await r('POST', '/workflows', { body: { name }, token: u.token, ws });
  const id = c.body?._id;
  const put = graph ? await r('PUT', `/workflows/${id}`, { body: graph, token: u.token, ws }) : null;
  return { id, put };
}
async function runAndWait(r, u, ws, wfId, tries = 120) {
  const start = await r('POST', `/workflows/${wfId}/runs`, { token: u.token, ws });
  const runId = start.body?.runId;
  if (!runId) return { start, run: null };
  for (let i = 0; i < tries; i++) {
    const g = await r('GET', `/runs/${runId}`, { token: u.token, ws });
    if (['success', 'failed', 'cancelled'].includes(g.body?.status)) return { start, run: g.body, raw: g.text };
    await sleep(150);
  }
  return { start, run: null };
}
const resultOf = (run, nodeId) => (run?.nodeResults || []).find((x) => x.nodeId === nodeId);

// Connections live either at /api/connections (spec 25) or nested under the
// workspace (implementation brief); resolved once against the running server.
let CONN_BASE = null;
const connPath = (ws, suffix = '') => (CONN_BASE === 'nested' ? `/workspaces/${ws}/connections${suffix}` : `/connections${suffix}`);
async function detectConnBase(r, u, ws) {
  const flat = await r('GET', '/connections', { token: u.token, ws });
  if (flat.status === 200 && Array.isArray(flat.body)) return 'flat';
  const nested = await r('GET', `/workspaces/${ws}/connections`, { token: u.token, ws });
  if (nested.status === 200 && Array.isArray(nested.body)) return 'nested';
  // Some list endpoints wrap the array; accept { connections: [] } too.
  if (flat.status === 200 && Array.isArray(flat.body?.connections)) return 'flat';
  if (nested.status === 200 && Array.isArray(nested.body?.connections)) return 'nested';
  return null;
}
const listOf = (body) => (Array.isArray(body) ? body : body?.connections || []);
const idOf = (c) => c?.id || c?._id;

/** Creates a connection; if the server wants non-secret auth fields in `config`, retries that way. */
async function createConnection(r, u, ws, { integration, name, mode, credentials, config }) {
  let res = await r('POST', connPath(ws), { body: { integration, name, mode, credentials, config }, token: u.token, ws });
  if (res.status === 400 && credentials?.scheme) {
    const { scheme, headerName, ...secret } = credentials;
    res = await r('POST', connPath(ws), { body: { integration, name, mode, credentials: secret, config: { ...(config || {}), scheme, ...(headerName && { headerName }) } }, token: u.token, ws });
  }
  return res;
}

// ====================================================================== setup
await mongoose.connect(DB_URI);
const db = mongoose.connection.db;
const oid = (id) => new mongoose.Types.ObjectId(String(id));

const { mod: registryMod, file: registryFile } = await firstModule(['../integrations/IntegrationRegistry.js', '../integrations/index.js']);
const Registry = pick(registryMod, ['IntegrationRegistry', 'default', 'registry']);
const { mod: modeMod, file: modeFile } = await firstModule(['../integrations/mode.js', '../config/integrations.js', '../integrations/IntegrationRegistry.js']);
const { mod: legacyMod, file: legacyFile } = await firstModule(['../integrations/normalizeToolConfig.js', '../integrations/legacy.js']);
const normalizeToolConfig = pick(legacyMod, ['normalizeToolConfig', 'default']);
const { mod: connMod, file: connFile } = await firstModule(['../services/connectionService.js', '../secrets/connections.js']);
const resolveConnection = pick(connMod, ['resolveConnection']);
const cacheMod = await import('../cache/TTLCache.js');

console.log(`integrations check · BASE=${B}`);
console.log(`  modules: registry=${registryFile} mode=${modeFile} legacy=${legacyFile} connections=${connFile}\n`);

const owner = await register(req, 'owner');
const WS = owner.ws;
const editor = await join(owner, WS, 'editor');
const viewer = await join(owner, WS, 'viewer');
const other = await register(req, 'other');
const WS2 = other.ws;
CONN_BASE = await detectConnBase(req, owner, WS);

// ====================================================================== A. manifests
console.log('A. manifests validate');
{
  const list = Registry?.list ? Registry.list() : [];
  check('IntegrationRegistry.list() returns integrations', Array.isArray(list) && list.length > 0, `${registryFile} · ${list?.length}`);
  const ids = list.map((i) => i.id);
  check('integration ids are unique', new Set(ids).size === ids.length, ids.join(','));
  for (const need of ['builtin', 'email', 'slack', 'http', 'database']) {
    check(`catalogue includes "${need}"`, ids.includes(need));
  }
  const expected = { builtin: ['fake-weather', 'calculator', 'fake-search'], email: ['send'], slack: ['post_message'], http: ['request'], database: ['insert', 'find', 'update'] };
  let shapeOk = true, sandboxOk = true, actionIdsUnique = true, noFns = true;
  const problems = [];
  for (const integ of list) {
    if (!integ.id || !integ.name || !integ.category || !integ.auth || !Array.isArray(integ.actions)) { shapeOk = false; problems.push(`${integ.id}: missing id/name/category/auth/actions`); }
    const aIds = (integ.actions || []).map((a) => a.id);
    if (new Set(aIds).size !== aIds.length) { actionIdsUnique = false; problems.push(`${integ.id}: duplicate action ids`); }
    for (const a of integ.actions || []) {
      if (!Array.isArray(a.configSchema)) { shapeOk = false; problems.push(`${integ.id}.${a.id}: configSchema not an array`); }
      const full = Registry.getAction?.(integ.id, a.id);
      const actionDef = full?.action || full;
      if (typeof actionDef?.sandbox !== 'function') { sandboxOk = false; problems.push(`${integ.id}.${a.id}: no sandbox()`); }
    }
    if (JSON.stringify(integ) !== JSON.stringify(integ, (k, v) => (typeof v === 'function' ? undefined : v))) noFns = false;
  }
  check('every manifest has id, name, category, auth and actions[]', shapeOk, problems.filter((p) => /missing|configSchema/.test(p)).join('; '));
  check('every action has a configSchema array', shapeOk);
  check('every action has a sandbox implementation (via getAction)', sandboxOk, problems.filter((p) => /sandbox/.test(p)).join('; '));
  check('action ids are unique within each integration', actionIdsUnique);
  check('list() is client-safe (no functions)', noFns);
  for (const [integ, actions] of Object.entries(expected)) {
    const got = (list.find((i) => i.id === integ)?.actions || []).map((a) => a.id);
    check(`${integ} exposes ${actions.join(', ')}`, actions.every((a) => got.includes(a)), got.join(','));
  }
  check('getAction() returns null for an unknown action', (Registry.getAction?.('slack', 'no_such_action') ?? null) === null
    && (Registry.getAction?.('no_such_integration', 'x') ?? null) === null);
  const liveCap = (id, a) => list.find((i) => i.id === id)?.actions?.find((x) => x.id === a)?.liveCapable;
  check('http.request and slack.post_message are live-capable; builtin is not', liveCap('http', 'request') === true && liveCap('slack', 'post_message') === true && !liveCap('builtin', 'calculator'));

  const api = await req('GET', '/integrations', { token: owner.token });
  check('GET /api/integrations → { integrations, defaults, liveEnabled }', api.status === 200 && Array.isArray(api.body?.integrations) && api.body?.defaults && 'liveEnabled' in api.body, `${api.status} ${brief(Object.keys(api.body || {}))}`);
  check('liveEnabled is false on the INTEGRATIONS_LIVE=false server', api.body?.liveEnabled === false, `${api.body?.liveEnabled}`);
  check('GET /api/integrations/:id returns one manifest', (await req('GET', '/integrations/slack', { token: owner.token })).body?.id === 'slack');
  check('GET /api/integrations requires auth', (await req('GET', '/integrations')).status === 401);
}

// ====================================================================== B. mode rule
console.log('\nB. mode rule truth table (spec 26 §3)');
{
  const expectedMode = ({ live, hasLive, authType, conn }) =>
    (live && hasLive && (conn?.mode === 'live' || (authType === 'none' && conn?.mode !== 'sandbox')) ? 'live' : 'sandbox');
  const fn = pick(modeMod, ['decideMode', 'resolveMode', 'modeFor', 'selectMode', 'chooseMode', 'determineMode', 'computeMode', 'actionMode']);
  check('mode rule function exported', typeof fn === 'function', `${modeFile}: ${modeMod ? Object.keys(modeMod).join(',') : 'none'}`);
  if (typeof fn === 'function') {
    const conns = { null: null, virtual: { id: 'sandbox', mode: 'sandbox' }, live: { id: 'c1', mode: 'live' }, sandbox: { id: 'c2', mode: 'sandbox' } };
    const liveFn = async () => ({});
    // The function's argument shape isn't pinned by the spec, so it's called with
    // a superset of plausible names; any implementation of the rule reads a subset.
    const call = ({ live, hasLive, authType, conn }) => {
      const action = { id: 'a', sandbox: liveFn, ...(hasLive && { live: liveFn }) };
      const integration = { id: 'x', auth: { type: authType, fields: [] }, actions: [action] };
      const args = { integrationsLive: live, liveEnabled: live, live, env: { integrationsLive: live }, action, integration, manifest: integration, auth: integration.auth, authType, connection: conn };
      try { return fn(args); } catch (err) { return `threw: ${err.message}`; }
    };
    let rows = 0, wrong = [];
    for (const live of [true, false]) for (const hasLive of [true, false]) for (const authType of ['none', 'bearer']) for (const [cname, conn] of Object.entries(conns)) {
      rows += 1;
      const want = expectedMode({ live, hasLive, authType, conn });
      let got = call({ live, hasLive, authType, conn });
      if (got && typeof got === 'object') got = got.mode;
      if (got !== want) wrong.push(`live=${live} action.live=${hasLive} auth=${authType} conn=${cname}: want ${want}, got ${got}`);
    }
    check(`all ${rows} combinations match the rule`, wrong.length === 0, wrong.slice(0, 4).join(' | '));
    const row = (label, args, want) => {
      let got = call(args); if (got && typeof got === 'object') got = got.mode;
      check(label, got === want, `got ${got}`);
    };
    row('Slack, live connection, INTEGRATIONS_LIVE=true → live', { live: true, hasLive: true, authType: 'webhookUrl', conn: conns.live }, 'live');
    row('Slack, no connection → sandbox', { live: true, hasLive: true, authType: 'webhookUrl', conn: null }, 'sandbox');
    row("Slack, connectionId 'sandbox' → sandbox", { live: true, hasLive: true, authType: 'webhookUrl', conn: conns.virtual }, 'sandbox');
    row('HTTP, no connection → live (C3)', { live: true, hasLive: true, authType: 'none', conn: null }, 'live');
    row('HTTP, live bearer connection → live', { live: true, hasLive: true, authType: 'none', conn: conns.live }, 'live');
    row("HTTP, connectionId 'sandbox' → sandbox (F)", { live: true, hasLive: true, authType: 'none', conn: conns.virtual }, 'sandbox');
    row('any node, INTEGRATIONS_LIVE=false → sandbox', { live: false, hasLive: true, authType: 'none', conn: conns.live }, 'sandbox');
    row('no live adapter, live connection → sandbox', { live: true, hasLive: false, authType: 'apiKey', conn: conns.live }, 'sandbox');
  }
}

// ====================================================================== C. legacy
console.log('\nC. legacy { toolType, toolConfig } normalisation (spec 26 §6)');
{
  check('normalizeToolConfig exported', typeof normalizeToolConfig === 'function', `${legacyFile}`);
  const MAP = {
    'fake-weather': ['builtin', 'fake-weather'], calculator: ['builtin', 'calculator'], 'fake-search': ['builtin', 'fake-search'],
    'send-email': ['email', 'send'], 'slack-message': ['slack', 'post_message'], 'http-request': ['http', 'request'],
    'database-write': ['database', 'insert'], 'mystery-tool': ['builtin', 'mystery-tool'],
  };
  if (typeof normalizeToolConfig === 'function') {
    for (const [toolType, [integration, action]] of Object.entries(MAP)) {
      const toolConfig = toolType === 'database-write' ? { collection: 'orders', document: '{"a":1}' } : { city: 'Oslo', channel: '#x', url: 'https://example.com' };
      const out = normalizeToolConfig({ label: 'L', toolType, toolConfig, mockOverrides: { failureRate: 0 } }) || {};
      const good = out.integration === integration && out.action === action && !('toolType' in out) && !('toolConfig' in out)
        && out.mockOverrides?.failureRate === 0 && out.label === 'L';
      check(`${toolType} → ${integration}.${action}`, good, brief(out));
      if (toolType === 'database-write') check('database-write keeps collection and carries document into params', out.params?.collection === 'orders' && out.params?.document !== undefined, brief(out.params));
      if (toolType === 'fake-weather') check('toolConfig → params unchanged', out.params?.city === 'Oslo', brief(out.params));
    }
    const both = normalizeToolConfig({ label: 'x', integration: 'slack', action: 'post_message', params: { channel: '#a' }, toolType: 'calculator', toolConfig: { expression: '1+1' } }) || {};
    check('integration wins when both shapes are present; legacy keys dropped', both.integration === 'slack' && both.action === 'post_message' && !('toolType' in both) && !('toolConfig' in both), brief(both));
    const modern = { label: 'm', integration: 'builtin', action: 'calculator', connectionId: null, params: { expression: '2*3' } };
    const same = normalizeToolConfig(JSON.parse(JSON.stringify(modern))) || {};
    check('an already-normalised config is left alone', same.integration === 'builtin' && same.action === 'calculator' && same.params?.expression === '2*3');
    const migrated = normalizeToolConfig({ label: 'h', toolType: 'http-request', toolConfig: { url: 'https://example.com' } }) || {};
    check('migrated HTTP nodes carry migratedFromMock and connectionId null', migrated.migratedFromMock === true && (migrated.connectionId ?? null) === null, brief(migrated));
  }

  // End to end: a phase-2-shaped workflow saved through PUT is normalised and runs.
  const legacyGraph = {
    nodes: [
      N('s', 'start'),
      N('w', 'tool', { toolType: 'fake-weather', toolConfig: { city: 'Lima' }, mockOverrides: { failureRate: 0, latencyMs: [20, 40] } }),
      N('c', 'tool', { toolType: 'calculator', toolConfig: { expression: '6*7' }, mockOverrides: { failureRate: 0, latencyMs: [20, 40] } }),
      N('h', 'tool', { toolType: 'http-request', toolConfig: { url: 'https://example.com/x', method: 'GET' }, mockOverrides: { failureRate: 0, latencyMs: [20, 40] } }),
      N('e', 'end'),
    ],
    edges: [E('s', 'w'), E('w', 'c'), E('c', 'h'), E('h', 'e')],
  };
  const wf = await makeWorkflow(req, owner, WS, 'legacy shaped', legacyGraph);
  check('PUT of a legacy-shaped graph is accepted', ok2xx(wf.put?.status), `${wf.put?.status} ${brief(wf.put?.body)}`);
  const got = await req('GET', `/workflows/${wf.id}`, { token: owner.token, ws: WS });
  const cfg = (id) => got.body?.nodes?.find((n) => n.id === id)?.data?.config || {};
  check('saved nodes are normalised (integration/action, no toolType)', cfg('w').integration === 'builtin' && cfg('w').action === 'fake-weather' && !cfg('w').toolType && cfg('h').integration === 'http', brief(cfg('w')));
  const { run } = await runAndWait(req, owner, WS, wf.id);
  check('legacy-shaped workflow runs to success', run?.status === 'success', `${run?.status} ${brief(run?.nodeResults?.map((r) => `${r.nodeId}:${r.status}`))}`);
  const rw = resultOf(run, 'w'), rh = resultOf(run, 'h');
  check('node result reports integration, action and mode', rw?.integration === 'builtin' && rw?.action === 'fake-weather' && rw?.mode === 'sandbox', brief({ integration: rw?.integration, action: rw?.action, mode: rw?.mode }));
  check('migrated http node runs sandbox on an INTEGRATIONS_LIVE=false server', rh?.mode === 'sandbox' && rh?.status === 'success', brief({ mode: rh?.mode, status: rh?.status }));
  check('GET /api/tools is removed', (await req('GET', '/tools', { token: owner.token })).status === 404);
}

// ====================================================================== D. connections over HTTP
console.log('\nD. connections: write-only credentials, merge semantics, permissions');
const SLACK_SECRET = `https://hooks.slack.com/services/T0SECRET/B0SECRET/${uniq()}xyzSECRET`;
const HTTP_TOKEN = `tok_${uniq()}_SECRETTOKEN`;
let slackConn = null, httpConn = null;
{
  check('connections API located', Boolean(CONN_BASE), `${CONN_BASE}`);
  const created = await createConnection(req, owner, WS, { integration: 'slack', name: `Acme alerts ${uniq()}`, mode: 'sandbox', credentials: { webhookUrl: SLACK_SECRET } });
  slackConn = created.body;
  check('POST connection → 201', created.status === 201, `${created.status} ${brief(created.body)}`);
  check('create response never echoes the secret', !created.text.includes(SLACK_SECRET) && !('credentials' in (created.body || {})), brief(Object.keys(created.body || {})));
  const hint = created.body?.credentialHints?.webhookUrl;
  check('credentialHints mask the secret as •••• + last 4', hint === `••••${SLACK_SECRET.slice(-4)}`, `${hint}`);
  check('response carries the public shape (id, integration, name, mode, status)', idOf(created.body) && created.body?.integration === 'slack' && created.body?.mode === 'sandbox' && created.body?.status, brief(created.body));
  const cid = idOf(slackConn);

  const list = await req('GET', connPath(WS), { token: owner.token, ws: WS });
  check('list never contains the secret, credentials or ciphertext', list.status === 200 && !list.text.includes(SLACK_SECRET) && !/ciphertext|"credentials"/.test(list.text), `${list.status}`);
  const one = await req('GET', connPath(WS, `/${cid}`), { token: owner.token, ws: WS });
  check('GET one never contains the secret or ciphertext', one.status === 200 && !one.text.includes(SLACK_SECRET) && !/ciphertext|"credentials"/.test(one.text), `${one.status}`);

  const rawConn = await db.collection('connections').findOne({ _id: oid(cid) });
  check('DB document holds ciphertext, not plaintext', rawConn && rawConn.credentials?.ciphertext && rawConn.credentials?.iv && rawConn.credentials?.tag && !JSON.stringify(rawConn).includes(SLACK_SECRET), brief(rawConn && Object.keys(rawConn)));
  check('DB document is scoped to the workspace', rawConn && String(rawConn.workspaceId) === String(WS));

  if (typeof resolveConnection === 'function') {
    const resolved = await resolveConnection(WS, cid, 'slack').catch((e) => ({ error: e.message }));
    check('resolveConnection decrypts inside the server', resolved?.credentials?.webhookUrl === SLACK_SECRET, brief({ ...resolved, credentials: resolved?.credentials ? '[present]' : undefined }));
    const foreign = await resolveConnection(WS2, cid, 'slack').then(() => 'resolved', (e) => e);
    check("resolveConnection refuses another workspace's connection", foreign !== 'resolved' && /not found/i.test(foreign?.message || ''), `${foreign?.message || foreign}`);
    const wrongInteg = await resolveConnection(WS, cid, 'http').then(() => 'resolved', (e) => e);
    check('resolveConnection refuses an integration mismatch', wrongInteg !== 'resolved', `${wrongInteg?.message || wrongInteg}`);
    const virtual = await resolveConnection(WS, 'sandbox', 'http');
    check("resolveConnection('sandbox') is the virtual sandbox connection", virtual?.mode === 'sandbox' && virtual?.id === 'sandbox', brief(virtual));
    check('resolveConnection(null) → null', (await resolveConnection(WS, null, 'http')) === null);
  } else {
    check('resolveConnection exported', false, `${connFile}`);
  }

  // PATCH merges: an omitted secret is kept.
  const renamed = await req('PATCH', connPath(WS, `/${cid}`), { body: { name: `Acme alerts renamed ${uniq()}` }, token: owner.token, ws: WS });
  check('PATCH without credentials keeps the secret (hint unchanged)', ok2xx(renamed.status) && renamed.body?.credentialHints?.webhookUrl === hint, `${renamed.status} ${brief(renamed.body?.credentialHints)}`);
  if (typeof resolveConnection === 'function') {
    const after = await resolveConnection(WS, cid, 'slack').catch(() => null);
    check('…and it still decrypts to the original value', after?.credentials?.webhookUrl === SLACK_SECRET);
  }
  check('PATCH response never echoes the secret', !renamed.text.includes(SLACK_SECRET));

  // null clears: an HTTP connection with an optional token.
  const hc = await createConnection(req, owner, WS, { integration: 'http', name: `API bearer ${uniq()}`, mode: 'live', credentials: { scheme: 'bearer', token: HTTP_TOKEN } });
  httpConn = hc.body;
  check('HTTP connection with an optional bearer token → 201', hc.status === 201, `${hc.status} ${brief(hc.body)}`);
  const hid = idOf(httpConn);
  const cleared = await req('PATCH', connPath(WS, `/${hid}`), { body: { credentials: { token: null } }, token: owner.token, ws: WS });
  check('PATCH { token: null } clears the secret', ok2xx(cleared.status) && !cleared.body?.credentialHints?.token, `${cleared.status} ${brief(cleared.body?.credentialHints)}`);
  if (typeof resolveConnection === 'function') {
    const c2 = await resolveConnection(WS, hid, 'http').catch(() => null);
    check('…and the stored credentials no longer have it', c2 && !c2.credentials?.token, brief(c2?.credentials ? Object.keys(c2.credentials) : c2));
  }
  const reset = await req('PATCH', connPath(WS, `/${hid}`), { body: { credentials: { token: HTTP_TOKEN } }, token: owner.token, ws: WS });
  check('credential change resets status to untested', ok2xx(reset.status) && reset.body?.status === 'untested', `${reset.body?.status}`);

  // Test endpoint.
  const tested = await req('POST', connPath(WS, `/${cid}/test`), { token: owner.token, ws: WS });
  check('POST /:id/test → { status }', ok2xx(tested.status) && ['ok', 'error'].includes(tested.body?.status), `${tested.status} ${brief(tested.body)}`);
  check('a sandbox-mode connection always tests ok', tested.body?.status === 'ok', brief(tested.body));
  const afterTest = await req('GET', connPath(WS, `/${cid}`), { token: owner.token, ws: WS });
  check('test result persisted (status + lastTestedAt)', afterTest.body?.status === tested.body?.status && afterTest.body?.lastTestedAt, brief({ status: afterTest.body?.status, lastTestedAt: afterTest.body?.lastTestedAt }));
  check('test response never echoes the secret', !tested.text.includes(SLACK_SECRET));

  // Duplicate names within (workspace, integration) → 409.
  const dup = await createConnection(req, owner, WS, { integration: 'slack', name: afterTest.body?.name, credentials: { webhookUrl: SLACK_SECRET } });
  check('duplicate name within (workspace, integration) → 409', dup.status === 409, `${dup.status}`);

  // Unknown credential keys are rejected.
  const unknown = await createConnection(req, owner, WS, { integration: 'slack', name: `bad ${uniq()}`, credentials: { webhookUrl: SLACK_SECRET, nope: 'x' } });
  check('unknown credential keys are rejected (400)', unknown.status === 400, `${unknown.status}`);
  const missing = await createConnection(req, owner, WS, { integration: 'slack', name: `missing ${uniq()}`, credentials: {} });
  check('missing required credential → 400', missing.status === 400, `${missing.status}`);

  // Permissions.
  const edCreate = await createConnection(req, editor, WS, { integration: 'slack', name: `ed ${uniq()}`, credentials: { webhookUrl: SLACK_SECRET } });
  check('editor cannot create a connection (403)', edCreate.status === 403, `${edCreate.status}`);
  check('editor can read one connection (connections:use)', (await req('GET', connPath(WS, `/${cid}`), { token: editor.token, ws: WS })).status === 200);
  check('editor can test a connection', ok2xx((await req('POST', connPath(WS, `/${cid}/test`), { token: editor.token, ws: WS })).status));
  check('editor cannot PATCH (403)', (await req('PATCH', connPath(WS, `/${cid}`), { body: { name: 'x' }, token: editor.token, ws: WS })).status === 403);
  check('editor cannot DELETE (403)', (await req('DELETE', connPath(WS, `/${cid}?force=true`), { body: { confirmName: afterTest.body?.name }, token: editor.token, ws: WS })).status === 403);
  const vList = await req('GET', connPath(WS), { token: viewer.token, ws: WS });
  const vRow = listOf(vList.body).find((c) => idOf(c) === cid);
  check('viewer sees names in the list', vList.status === 200 && vRow?.name, `${vList.status}`);
  check('viewer list is stripped of hints and config', vRow && !vRow.credentialHints && !vRow.config, brief(vRow));
  check('viewer cannot GET one connection (403)', (await req('GET', connPath(WS, `/${cid}`), { token: viewer.token, ws: WS })).status === 403);
  check('viewer cannot test (403)', (await req('POST', connPath(WS, `/${cid}/test`), { token: viewer.token, ws: WS })).status === 403);
  check('viewer cannot create (403)', (await createConnection(req, viewer, WS, { integration: 'slack', name: `v ${uniq()}`, credentials: { webhookUrl: SLACK_SECRET } })).status === 403);
  const foreignGet = await req('GET', connPath(WS2, `/${cid}`), { token: other.token, ws: WS2 });
  check("another workspace can't read it (404)", foreignGet.status === 404, `${foreignGet.status}`);
  check("another workspace can't test it (404)", (await req('POST', connPath(WS2, `/${cid}/test`), { token: other.token, ws: WS2 })).status === 404);
  check("another workspace's header can't reach WS's list", (await req('GET', connPath(WS), { token: other.token, ws: WS })).status === 404);

  // Workflow save validates connectionId.
  const foreignWf = await makeWorkflow(req, other, WS2, 'steals a connection', chain(toolNode('t', 'slack', 'post_message', { connectionId: cid, params: { channel: '#x', text: 'hi' } })));
  check("saving a node with another workspace's connection → 400", foreignWf.put?.status === 400 && /connection/i.test(foreignWf.put?.body?.error || ''), `${foreignWf.put?.status} ${foreignWf.put?.body?.error}`);
  const wrongInteg = await makeWorkflow(req, owner, WS, 'wrong integration', chain(toolNode('t', 'http', 'request', { connectionId: cid, params: { url: 'https://example.com' } })));
  check("saving a node whose connection is for another integration → 400", wrongInteg.put?.status === 400, `${wrongInteg.put?.status}`);

  // A run using the connection: secret never appears in run or workflow payloads.
  const usesIt = await makeWorkflow(req, owner, WS, 'uses slack', chain(toolNode('t', 'slack', 'post_message', { connectionId: cid, params: { channel: '#alerts', text: 'Deploy done' } })));
  check('saving a node with an own connection → 2xx', ok2xx(usesIt.put?.status), `${usesIt.put?.status} ${brief(usesIt.put?.body)}`);
  const { run, raw } = await runAndWait(req, owner, WS, usesIt.id);
  const rt = resultOf(run, 't');
  check('slack node runs (sandbox connection) and records mode', run?.status === 'success' && rt?.mode === 'sandbox' && rt?.integration === 'slack', brief({ status: run?.status, mode: rt?.mode, err: rt?.logs?.slice(-2) }));
  check('run payload never contains the secret', raw && !raw.includes(SLACK_SECRET));
  const wfGet = await req('GET', `/workflows/${usesIt.id}`, { token: owner.token, ws: WS });
  check('workflow payload never contains the secret', wfGet.status === 200 && !wfGet.text.includes(SLACK_SECRET));
  const rawRun = await db.collection('runs').findOne({ _id: oid(run?._id || '000000000000000000000000') });
  check('persisted run document never contains the secret', rawRun && !JSON.stringify(rawRun).includes(SLACK_SECRET));
  // spec/30: a share link shows the published version.
  await req('POST', `/workflows/${usesIt.id}/publish`, { body: { acknowledgeWarnings: true }, token: owner.token, ws: WS });
  const share = await req('POST', `/workflows/${usesIt.id}/share`, { token: owner.token, ws: WS });
  const shared = share.body?.shareToken ? await req('GET', `/shared/${share.body.shareToken}`) : null;
  check('shared view never contains the secret', shared?.status === 200 && !shared.text.includes(SLACK_SECRET), `${shared?.status}`);

  // Usage + delete.
  const usage = await req('GET', connPath(WS, `/${cid}/usage`), { token: owner.token, ws: WS });
  const usageList = Array.isArray(usage.body) ? usage.body : usage.body?.usage || [];
  check('GET /:id/usage lists the referencing workflow', usage.status === 200 && usageList.some((u) => String(u.workflowId) === String(usesIt.id)), `${usage.status} ${brief(usage.body)}`);
  const del409 = await req('DELETE', connPath(WS, `/${cid}`), { token: owner.token, ws: WS });
  const del409Usage = del409.body?.usage || [];
  check('DELETE of an in-use connection → 409 with usage', del409.status === 409 && del409Usage.some((u) => String(u.workflowId) === String(usesIt.id)), `${del409.status} ${brief(del409.body)}`);
  const del = await req('DELETE', connPath(WS, `/${cid}?force=true`), { body: { confirmName: afterTest.body?.name, force: true }, token: owner.token, ws: WS });
  check('forced/confirmed DELETE → 204', del.status === 204, `${del.status} ${brief(del.body)}`);
  check('connection document is gone', !(await db.collection('connections').findOne({ _id: oid(cid) })));
  const dangling = await runAndWait(req, owner, WS, usesIt.id);
  const dt = resultOf(dangling.run, 't');
  check('a node left pointing at the deleted connection fails in one attempt', dt?.status === 'failed' && (dt?.attempts ?? 1) === 1 && /not found/i.test(JSON.stringify(dt?.logs || dt?.output || '')), brief({ status: dt?.status, attempts: dt?.attempts, logs: dt?.logs?.slice(-2) }));

  // Templates null every connectionId.
  const hid2 = idOf(httpConn);
  const tplWf = await makeWorkflow(req, owner, WS, 'template source', chain(toolNode('t', 'http', 'request', { connectionId: hid2, params: { url: 'https://example.com' } })));
  const tpl = await req('POST', '/templates', { body: { workflowId: tplWf.id, name: `tpl ${uniq()}`, description: 'x' }, token: owner.token, ws: WS });
  const tplId = tpl.body?.id || tpl.body?._id;
  const tplDoc = tplId ? await db.collection('templates').findOne({ _id: oid(tplId) }) : null;
  const tplConn = tplDoc?.nodes?.find((n) => n.id === 't')?.data?.config?.connectionId;
  check('saving as a template nulls every connectionId', tpl.status === 201 && tplDoc && (tplConn ?? null) === null, `${tpl.status} connectionId=${tplConn}`);
}

// ====================================================================== E. AAD binding
console.log('\nE. AAD binding: a ciphertext copied into another connection does not decrypt');
{
  const secretA = `https://hooks.slack.com/services/TA/BA/${uniq()}AADSECRET`;
  const a = await createConnection(req, owner, WS, { integration: 'slack', name: `aad-a ${uniq()}`, mode: 'sandbox', credentials: { webhookUrl: secretA } });
  const b = await createConnection(req, owner, WS, { integration: 'slack', name: `aad-b ${uniq()}`, mode: 'sandbox', credentials: { webhookUrl: `https://hooks.slack.com/services/TB/BB/${uniq()}other` } });
  const aid = idOf(a.body), bid = idOf(b.body);
  const rawA = await db.collection('connections').findOne({ _id: oid(aid) });
  await db.collection('connections').updateOne({ _id: oid(bid) }, { $set: { credentials: rawA.credentials } });
  if (typeof resolveConnection === 'function') {
    const res = await resolveConnection(WS, bid, 'slack').then((c) => c, (e) => e);
    check('resolveConnection on the tampered connection throws', res instanceof Error, brief(res?.credentials ? '[decrypted!]' : res?.message));
    check('…with a clear message and no plaintext', res instanceof Error && !String(res.message).includes(secretA) && /decrypt|credential|re-enter/i.test(res.message), `${res?.message}`);
  }
  // Test in live mode so the manifest's test() would need the credentials.
  await req('PATCH', connPath(WS, `/${bid}`), { body: { mode: 'live' }, token: owner.token, ws: WS });
  await db.collection('connections').updateOne({ _id: oid(bid) }, { $set: { credentials: rawA.credentials } });
  const t = await req('POST', connPath(WS, `/${bid}/test`), { token: owner.token, ws: WS });
  check('testing the tampered connection reports error, not a crash', t.status < 500 && (t.body?.status === 'error'), `${t.status} ${brief(t.body)}`);
  check('…and never leaks the other connection\'s secret', !t.text.includes(secretA));
  const g = await req('GET', connPath(WS, `/${bid}`), { token: owner.token, ws: WS });
  check('tampered connection shows status error', g.body?.status === 'error', `${g.body?.status} ${g.body?.lastError}`);
  const stillA = typeof resolveConnection === 'function' ? await resolveConnection(WS, aid, 'slack').catch(() => null) : null;
  check('the original connection is unaffected', typeof resolveConnection !== 'function' || stillA?.credentials?.webhookUrl === secretA);
}

// ====================================================================== F. sandbox forcing
console.log("\nF. connectionId 'sandbox' forces sandbox (unit; end to end in H)");
{
  const wf = await makeWorkflow(req, owner, WS, 'forced sandbox http', chain(toolNode('h', 'http', 'request', { connectionId: 'sandbox', params: { url: 'https://example.com/forced', method: 'GET' } })));
  check("saving connectionId 'sandbox' is accepted", ok2xx(wf.put?.status), `${wf.put?.status} ${brief(wf.put?.body)}`);
  const { run } = await runAndWait(req, owner, WS, wf.id);
  const r = resultOf(run, 'h');
  check("http.request with connectionId 'sandbox' runs in sandbox", r?.status === 'success' && r?.mode === 'sandbox', brief({ status: r?.status, mode: r?.mode }));
}

// ====================================================================== G. cache
console.log('\nG. cache keys include workspace and connection');
{
  const key = cacheMod.toolCacheKey;
  const base = { integration: 'builtin', action: 'fake-weather', params: { city: 'Oslo' }, input: { a: 1 } };
  let k = (o) => {
    try { return key(o); } catch { return null; }
  };
  const objectForm = typeof k({ workspaceId: 'w1', connectionId: 'c1', ...base }) === 'string' && key.length <= 1;
  if (!objectForm) {
    // Positional fallback in case the key kept a positional signature.
    k = (o) => key(o.workspaceId, `${o.integration}.${o.action}`, { connectionId: o.connectionId, params: o.params }, o.input);
  }
  const kA = k({ workspaceId: 'w1', connectionId: 'c1', ...base });
  const kB = k({ workspaceId: 'w1', connectionId: 'c2', ...base });
  const kW = k({ workspaceId: 'w2', connectionId: 'c1', ...base });
  check('toolCacheKey takes { workspaceId, integration, action, connectionId, params, input }', objectForm, `arity=${key.length}`);
  check('identical params, different connections → different keys', kA && kB && kA !== kB);
  check('identical params, different workspaces → different keys', kA && kW && kA !== kW);
  const reordered = k({ input: { a: 1 }, params: { city: 'Oslo' }, action: 'fake-weather', integration: 'builtin', connectionId: 'c1', workspaceId: 'w1' });
  check('key is stable under key reordering (stable JSON)', reordered === kA);
  const nested1 = k({ workspaceId: 'w1', connectionId: null, integration: 'builtin', action: 'calculator', params: { a: 1, b: 2 }, input: { x: { p: 1, q: 2 } } });
  const nested2 = k({ workspaceId: 'w1', connectionId: null, integration: 'builtin', action: 'calculator', params: { b: 2, a: 1 }, input: { x: { q: 2, p: 1 } } });
  check('nested key order does not change the key', nested1 === nested2);

  // End to end: same workspace hits, other workspace misses.
  const graph = () => chain(toolNode('w', 'builtin', 'fake-weather', { params: { city: `Cachetown-${uniq()}` } }));
  const g = graph();
  const w1a = await makeWorkflow(req, owner, WS, 'cache 1a', g);
  const w1b = await makeWorkflow(req, owner, WS, 'cache 1b', g);
  const w2 = await makeWorkflow(req, other, WS2, 'cache 2', g);
  const r1a = resultOf((await runAndWait(req, owner, WS, w1a.id)).run, 'w');
  const r1b = resultOf((await runAndWait(req, owner, WS, w1b.id)).run, 'w');
  const r2 = resultOf((await runAndWait(req, other, WS2, w2.id)).run, 'w');
  check('first call is not cached', r1a?.status === 'success' && r1a?.cached !== true, brief({ status: r1a?.status, cached: r1a?.cached }));
  check('same workspace, identical call → cache hit (positive control)', r1b?.cached === true, brief({ cached: r1b?.cached }));
  check('other workspace, identical call → no cache hit', r2?.status === 'success' && r2?.cached !== true, brief({ status: r2?.status, cached: r2?.cached }));

  // Side-effecting actions are never cached.
  const se = chain(toolNode('m', 'email', 'send', { params: { to: 'x@example.com', subject: `hi ${uniq()}`, body: 'b' } }));
  const s1 = await makeWorkflow(req, owner, WS, 'email 1', se);
  const s2 = await makeWorkflow(req, owner, WS, 'email 2', se);
  const e1 = resultOf((await runAndWait(req, owner, WS, s1.id)).run, 'm');
  const e2 = resultOf((await runAndWait(req, owner, WS, s2.id)).run, 'm');
  check('side-effecting action (email.send) runs both times, never cached', e1?.status === 'success' && e2?.status === 'success' && e2?.cached !== true, brief({ e1: e1?.status, e2: e2?.status, cached: e2?.cached }));
}

// ====================================================================== H. live path + redaction
console.log('\nH. live path on a private INTEGRATIONS_LIVE=true server: mode, redaction, retries');
{
  const LIVE_PORT = Number(process.env.LIVE_PORT || 4699);
  const LIVE_DB = `${DB_URI.replace(/\/+$/, '')}-intlive`;
  const LB = `http://localhost:${LIVE_PORT}/api`;
  const lreq = client(LB);
  let flakyHits = 0, notFoundHits = 0;
  const echo = http.createServer((rq, rs) => {
    let body = '';
    rq.on('data', (c) => { body += c; });
    rq.on('end', () => {
      if (rq.url.startsWith('/notfound')) { notFoundHits += 1; rs.writeHead(404, { 'Content-Type': 'application/json' }); return rs.end('{"error":"nope"}'); }
      if (rq.url.startsWith('/flaky')) { flakyHits += 1; rs.writeHead(503, { 'Content-Type': 'application/json' }); return rs.end('{"error":"busy"}'); }
      rs.writeHead(200, { 'Content-Type': 'application/json' });
      rs.end(JSON.stringify({ method: rq.method, url: rq.url, headers: rq.headers, body }));
    });
  });
  await new Promise((r) => echo.listen(0, '127.0.0.1', r));
  const ECHO = `http://127.0.0.1:${echo.address().port}`;

  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: SERVER_ROOT,
    env: { ...process.env, PORT: String(LIVE_PORT), MONGODB_URI: LIVE_DB, INTEGRATIONS_LIVE: 'true', HTTP_TOOL_ALLOW_PRIVATE_NETWORKS: 'true', HTTP_TOOL_ALLOWED_HOSTS: '', PUBLIC_BASE_URL: `http://localhost:${LIVE_PORT}`, QUEUE_BASE_BACKOFF_MS: '100' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childLog = '';
  child.stdout.on('data', (d) => { childLog += d; });
  child.stderr.on('data', (d) => { childLog += d; });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    await sleep(250);
    up = await fetch(`${LB}/health`).then((r) => r.ok, () => false);
  }
  check('private live server started', up, up ? '' : brief(childLog, 400));

  try {
    if (up) {
      const lo = await register(lreq, 'liveowner');
      const cfg = await lreq('GET', '/integrations', { token: lo.token });
      check('liveEnabled is true on the live server', cfg.body?.liveEnabled === true, `${cfg.body?.liveEnabled}`);
      const TOKEN = `live_${uniq()}_BEARERSECRET`;
      let c = await lreq('POST', connPath(lo.ws), { body: { integration: 'http', name: 'echo bearer', mode: 'live', credentials: { scheme: 'bearer', token: TOKEN } }, token: lo.token, ws: lo.ws });
      if (c.status === 400) c = await lreq('POST', connPath(lo.ws), { body: { integration: 'http', name: 'echo bearer', mode: 'live', credentials: { token: TOKEN }, config: { scheme: 'bearer' } }, token: lo.token, ws: lo.ws });
      const conn = idOf(c.body);
      check('live server: bearer connection created', c.status === 201, `${c.status} ${brief(c.body)}`);

      // Echo: the token reaches the echo server but never the persisted run.
      const echoWf = await makeWorkflow(lreq, lo, lo.ws, 'live echo', chain(toolNode('h', 'http', 'request', { connectionId: conn, params: { url: `${ECHO}/echo?token-probe=1`, method: 'GET' } })));
      check('live workflow saved', ok2xx(echoWf.put?.status), `${echoWf.put?.status} ${brief(echoWf.put?.body)}`);
      const { run, raw } = await runAndWait(lreq, lo, lo.ws, echoWf.id);
      const r = resultOf(run, 'h');
      check('http.request with a live connection runs live', r?.status === 'success' && r?.mode === 'live', brief({ status: r?.status, mode: r?.mode, logs: r?.logs?.slice(-2) }));
      const echoedAuth = r?.output?.body?.headers?.authorization;
      check('the echo server received an Authorization header', typeof echoedAuth === 'string' && echoedAuth.length > 0, `${echoedAuth}`);
      check('…which is redacted in the output (••••)', typeof echoedAuth === 'string' && echoedAuth.includes('••••') && !echoedAuth.includes(TOKEN), `${echoedAuth}`);
      check('the token appears nowhere in the REST run payload', raw && !raw.includes(TOKEN));
      const lconn = await mongoose.createConnection(LIVE_DB).asPromise();
      const rawRun = await lconn.db.collection('runs').findOne({ _id: oid(run?._id || '000000000000000000000000') });
      check('the token appears nowhere in the persisted run (logs, output, errors)', rawRun && !JSON.stringify(rawRun).includes(TOKEN));

      // No connection → live (C3); 'sandbox' → sandbox.
      const plain = await makeWorkflow(lreq, lo, lo.ws, 'live no connection', chain(toolNode('h', 'http', 'request', { params: { url: `${ECHO}/echo`, method: 'GET' } })));
      const pr = resultOf((await runAndWait(lreq, lo, lo.ws, plain.id)).run, 'h');
      check('http.request with no connection runs live (C3)', pr?.status === 'success' && pr?.mode === 'live', brief({ status: pr?.status, mode: pr?.mode }));
      const forced = await makeWorkflow(lreq, lo, lo.ws, 'live forced sandbox', chain(toolNode('h', 'http', 'request', { connectionId: 'sandbox', params: { url: `${ECHO}/echo?forced=1`, method: 'GET' } })));
      const before = echo.listenerCount('request');
      const fr = resultOf((await runAndWait(lreq, lo, lo.ws, forced.id)).run, 'h');
      check("connectionId 'sandbox' runs sandbox even with live allowed", fr?.status === 'success' && fr?.mode === 'sandbox', brief({ status: fr?.status, mode: fr?.mode }));
      void before;

      // 404 → permanent, one attempt.
      const nf = await makeWorkflow(lreq, lo, lo.ws, 'live 404', chain(toolNode('h', 'http', 'request', { params: { url: `${ECHO}/notfound`, method: 'GET' }, mockOverrides: { maxAttempts: 3 } })));
      notFoundHits = 0;
      const nr = resultOf((await runAndWait(lreq, lo, lo.ws, nf.id)).run, 'h');
      check('a live 404 fails the node', nr?.status === 'failed', brief({ status: nr?.status, logs: nr?.logs?.slice(-2) }));
      check('…in one attempt (permanent, not retried)', (nr?.attempts ?? 0) === 1 && notFoundHits === 1, `attempts=${nr?.attempts} hits=${notFoundHits}`);

      // 503 → retried.
      const fl = await makeWorkflow(lreq, lo, lo.ws, 'live 503', chain(toolNode('h', 'http', 'request', { params: { url: `${ECHO}/flaky`, method: 'GET' }, mockOverrides: { maxAttempts: 2 } })));
      flakyHits = 0;
      const flr = resultOf((await runAndWait(lreq, lo, lo.ws, fl.id, 200)).run, 'h');
      check('a live 503 is retried (attempts > 1)', (flr?.attempts ?? 0) > 1 && flakyHits > 1, `attempts=${flr?.attempts} hits=${flakyHits} status=${flr?.status}`);
      check('…and fails once maxAttempts is used up', flr?.status === 'failed' && flr?.attempts === 2, `${flr?.status} ${flr?.attempts}`);

      // Failure injection is sandbox-only: failureRate 1 on a live call doesn't fire.
      const inj = await makeWorkflow(lreq, lo, lo.ws, 'live injection', chain(toolNode('h', 'http', 'request', { params: { url: `${ECHO}/echo?inj=1`, method: 'GET' }, mockOverrides: { failureRate: 1, maxAttempts: 1 } })));
      const ir = resultOf((await runAndWait(lreq, lo, lo.ws, inj.id)).run, 'h');
      check('failure injection does not apply to live calls', ir?.status === 'success' && ir?.mode === 'live', brief({ status: ir?.status, mode: ir?.mode }));

      await lconn.dropDatabase().catch(() => {});
      await lconn.close();
    }
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => { child.once('exit', r); setTimeout(r, 3000); });
    echo.close();
    // Belt and braces: drop the live DB even if the section bailed early.
    const cleanup = await mongoose.createConnection(LIVE_DB).asPromise().catch(() => null);
    if (cleanup) { await cleanup.dropDatabase().catch(() => {}); await cleanup.close(); }
  }
}

await mongoose.disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
