/**
 * Realtime check for spec/24 - socket auth, authorized rooms, eviction, per-
 * workspace queue stats, workspace API keys, the public run API and namespaced
 * events, as a runnable script. Needs a running server and its database:
 *
 *   PORT=4500 MONGODB_URI=...-check npm run dev                          # terminal 1
 *   BASE=http://localhost:4500/api MONGODB_URI=... npm run check:realtime # terminal 2
 *
 * Uses real socket.io clients (several at once) against the server, so what's
 * asserted is what a browser tab would actually receive - including, crucially,
 * what it must NOT receive from another tenant.
 */
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { io } from 'socket.io-client';
import { env } from '../config/env.js';
import { permissionsFor } from '../tenancy/permissions.js';

const B = process.env.BASE || 'http://localhost:4500/api';
const SOCKET_URL = B.replace(/\/api\/?$/, '');
const DB_URI = process.env.MONGODB_URI;
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`); ok ? pass++ : fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok2xx = (s) => s >= 200 && s < 300;

if (!DB_URI) {
  console.error('MONGODB_URI must be set to the running server\'s database');
  process.exit(1);
}

async function req(method, p, { body, token, ws, apiKey, apiKeyHeader } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (apiKeyHeader) headers['X-API-Key'] = apiKeyHeader;
  if (ws) headers['X-Workspace-Id'] = String(ws);
  const res = await fetch(B + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, body: json };
}

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const newEmail = (tag) => `${tag}${uniq()}@rt.dev`;
async function register(tag, email = newEmail(tag)) {
  const r = await req('POST', '/auth/register', { body: { email, password: 'password123', name: tag } });
  return { token: r.body?.token, user: r.body?.user, email, ws: r.body?.workspaces?.[0]?.id, slug: r.body?.workspaces?.[0]?.slug };
}
async function join(owner, ws, role, tag = role) {
  const email = newEmail(tag);
  const inv = await req('POST', `/workspaces/${ws}/invitations`, { body: { email, role }, token: owner.token });
  const u = await register(tag, email);
  const token = String(inv.body?.inviteUrl || '').split('/invite/').pop();
  await req('POST', `/invitations/${token}/accept`, { token: u.token });
  return u;
}

const N = (id, type, config) => ({ id, type, position: { x: 0, y: 0 }, data: { config } });
const graph = (ms = 40) => ({
  nodes: [
    N('s', 'start', { label: 'Start' }),
    // Unique expression per workflow: identical tool input would be a cache hit
    // and finish without ever touching the queue.
    N('t', 'tool', { label: 'Calc', toolType: 'calculator', toolConfig: { expression: `1+${uniq()}` }, mockOverrides: { failureRate: 0, latencyMs: [ms, ms + 20] } }),
    N('e', 'end', { label: 'End' }),
  ],
  edges: [{ id: 'e1', source: 's', target: 't' }, { id: 'e2', source: 't', target: 'e' }],
});
async function makeWorkflow(u, ws, name, g = graph()) {
  const r = await req('POST', '/workflows', { body: { name }, token: u.token, ws });
  await req('PUT', `/workflows/${r.body?._id}`, { body: g, token: u.token, ws });
  // spec/30: triggers and share links use the PUBLISHED version, so fixtures
  // are published the way a user would press Publish after building them.
  await req('POST', `/workflows/${r.body?._id}/publish`, { body: { acknowledgeWarnings: true }, token: u.token, ws });
  return r.body?._id;
}
async function waitRun(u, ws, runId, tries = 80) {
  for (let i = 0; i < tries; i++) {
    const r = await req('GET', `/runs/${runId}`, { token: u.token, ws });
    if (['success', 'failed', 'cancelled'].includes(r.body?.status)) return r.body;
    await sleep(150);
  }
  return (await req('GET', `/runs/${runId}`, { token: u.token, ws })).body;
}

/** A connected client that records every event it receives, with a timestamp. */
function client(token) {
  const events = [];
  const socket = io(SOCKET_URL, { auth: token === undefined ? undefined : { token }, transports: ['websocket'], forceNew: true, reconnection: false });
  socket.onAny((event, payload) => events.push({ event, payload, at: Date.now() }));
  const ready = new Promise((resolve) => {
    socket.once('connect', () => resolve({ ok: true }));
    socket.once('connect_error', (err) => resolve({ ok: false, message: err?.message }));
  });
  const ack = (event, payload) => socket.timeout(3000).emitWithAck(event, payload).catch((e) => ({ ok: false, error: `timeout: ${e.message}` }));
  const got = (event, pred = () => true) => events.filter((e) => e.event === event && pred(e.payload));
  return { socket, events, ready, ack, got, close: () => socket.close() };
}
const waitFor = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(50); } return fn(); };

await mongoose.connect(DB_URI);
const db = mongoose.connection.db;
const sockets = [];
const open = (t) => { const c = client(t); sockets.push(c); return c; };

// Two tenants: Acme (owner A + members) and Globex (owner G).
const A = await register('acmeowner');
const acmeRes = await req('POST', '/workspaces', { body: { name: `Acme ${uniq()}` }, token: A.token });
const ACME = acmeRes.body?.id, ACME_SLUG = acmeRes.body?.slug;
const G = await register('globexowner');
const GLOBEX = G.ws, GLOBEX_SLUG = G.slug;

// ------------------------------------------------------------------ auth
console.log('A. socket handshake requires a valid JWT');
{
  const none = open(undefined);
  const r1 = await none.ready;
  check('no token -> connect_error "unauthorized"', !r1.ok && r1.message === 'unauthorized', JSON.stringify(r1));
  const junk = open('not-a-jwt');
  const r2 = await junk.ready;
  check('garbage token -> refused', !r2.ok && r2.message === 'unauthorized', JSON.stringify(r2));
  const expired = jwt.sign({ sub: A.user.id, exp: Math.floor(Date.now() / 1000) - 60 }, env.jwtSecret);
  const old = open(expired);
  const r3 = await old.ready;
  check('expired token -> refused', !r3.ok && r3.message === 'unauthorized', JSON.stringify(r3));
  const good = open(A.token);
  check('valid token connects', (await good.ready).ok);
  good.close();
}

// ------------------------------------------------------------------ rooms
console.log('\nB. every room join is authorized');
const acmeWf = await makeWorkflow(A, ACME, 'acme flow', graph(700));
const globexWf = await makeWorkflow(G, GLOBEX, 'globex flow', graph(700));
{
  const g = open(G.token); await g.ready;
  const acmeRun = (await req('POST', `/workflows/${acmeWf}/runs`, { token: A.token, ws: ACME })).body?.runId;

  const r1 = await g.ack('run:subscribe', { runId: acmeRun });
  check('foreign run:subscribe -> { ok:false, error:"not_found" }', r1?.ok === false && r1?.error === 'not_found', JSON.stringify(r1));
  const r2 = await g.ack('workflow:subscribe', { workflowId: acmeWf });
  check('foreign workflow:subscribe -> not_found', r2?.ok === false && r2?.error === 'not_found', JSON.stringify(r2));
  const r3 = await g.ack('workspace:subscribe', { workspaceId: ACME });
  check('foreign workspace:subscribe -> not_found', r3?.ok === false && r3?.error === 'not_found', JSON.stringify(r3));
  const r4 = await g.ack('run:subscribe', { runId: new mongoose.Types.ObjectId().toString() });
  check('nonexistent run looks the same as foreign (not_found)', r4?.ok === false && r4?.error === 'not_found', JSON.stringify(r4));
  const r5 = await g.ack('run:subscribe', { runId: 'garbage' });
  check('malformed id -> not_found, not a crash', r5?.ok === false && r5?.error === 'not_found', JSON.stringify(r5));

  // own subscriptions work and deliver events
  const a = open(A.token); await a.ready;
  const ownWorkflow = await a.ack('workflow:subscribe', { workflowId: acmeWf });
  check('own workflow:subscribe -> ok', ownWorkflow?.ok === true, JSON.stringify(ownWorkflow));
  const ownWs = await a.ack('workspace:subscribe', { workspaceId: ACME });
  check('own workspace:subscribe -> ok', ownWs?.ok === true, JSON.stringify(ownWs));
  const ownRunId = (await req('POST', `/workflows/${await makeWorkflow(A, ACME, 'watched', graph(600))}/runs`, { token: A.token, ws: ACME })).body?.runId;
  const ownRun = await a.ack('run:subscribe', { runId: ownRunId });
  check('own run:subscribe -> ok', ownRun?.ok === true, JSON.stringify(ownRun));
  await waitFor(() => a.got('run:completed', (p) => p?.runId === ownRunId).length > 0, 6000);
  check('subscriber receives node:update for its run', a.got('node:update', (p) => p?.runId === ownRunId).length > 0);
  check('subscriber receives run:completed for its run', a.got('run:completed', (p) => p?.runId === ownRunId).length > 0);
  console.log(`  · run:started received: ${a.got('run:started', (p) => p?.runId === ownRunId).length > 0} (may race the subscribe; informational)`);

  await waitRun(A, ACME, acmeRun);
  const leaked = g.events.filter((e) => JSON.stringify(e.payload || {}).includes(acmeRun) || e.payload?.workspaceId === ACME);
  check('the Globex socket received nothing about the Acme run', leaked.length === 0, leaked.map((e) => e.event).join(','));
  g.close(); a.close();
}

// ------------------------------------------------------------------ queue stats
console.log('\nC. queue:stats is per workspace');
{
  const a = open(A.token); await a.ready; await a.ack('workspace:subscribe', { workspaceId: ACME });
  const g = open(G.token); await g.ready; await g.ack('workspace:subscribe', { workspaceId: GLOBEX });
  const bare = open(A.token); await bare.ready; // connected, but subscribed to no workspace
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const wf = await makeWorkflow(A, ACME, `load ${i}`, graph(200));
    runs.push((await req('POST', `/workflows/${wf}/runs`, { token: A.token, ws: ACME })).body?.runId);
  }
  for (const r of runs) await waitRun(A, ACME, r);
  await sleep(300);
  const aStats = a.got('queue:stats');
  check('Acme socket received queue:stats for Acme', aStats.some((e) => e.payload?.workspaceId === ACME), `${aStats.length} events`);
  check('every stats payload Acme got is tagged Acme', aStats.length > 0 && aStats.every((e) => e.payload?.workspaceId === ACME));
  check('stats payload shape { workspaceId, active, queued, concurrency }', aStats.every((e) => ['active', 'queued', 'concurrency'].every((k) => typeof e.payload?.[k] === 'number')), JSON.stringify(aStats[0]?.payload));
  check('Globex socket received zero Acme queue:stats', g.got('queue:stats', (p) => p?.workspaceId === ACME).length === 0);
  // A snapshot on workspace:subscribe is fine - it just has to be Globex's own.
  check('any stats Globex got are its own (e.g. the join snapshot), all idle', g.got('queue:stats').every((e) => e.payload?.workspaceId === GLOBEX && e.payload?.active === 0 && e.payload?.queued === 0),
    JSON.stringify(g.got('queue:stats').map((e) => e.payload)));
  check('a socket in no workspace room gets no queue:stats (no broadcast)', bare.got('queue:stats').length === 0, `${bare.got('queue:stats').length}`);
  a.close(); g.close(); bare.close();
}

// ------------------------------------------------------------------ eviction + role changes
console.log('\nD. removal evicts sockets; role changes are pushed live');
{
  const M = await join(A, ACME, 'editor', 'member');
  const m = open(M.token); await m.ready;
  const own = open(A.token); await own.ready;
  const slowWf = await makeWorkflow(A, ACME, 'slow', graph(2500));
  const slowRun = (await req('POST', `/workflows/${slowWf}/runs`, { token: A.token, ws: ACME })).body?.runId;
  const sub = await m.ack('run:subscribe', { runId: slowRun });
  check('member can subscribe to the workspace\'s run', sub?.ok === true, JSON.stringify(sub));
  await m.ack('workspace:subscribe', { workspaceId: ACME });
  await m.ack('workflow:subscribe', { workflowId: slowWf });
  await own.ack('run:subscribe', { runId: slowRun });

  await sleep(300);
  const rm = await req('DELETE', `/workspaces/${ACME}/members/${M.user.id}`, { token: A.token });
  check('owner removes the member (204)', rm.status === 204, `${rm.status}`);
  const gotRevoked = await waitFor(() => m.got('workspace:access_revoked', (p) => p?.workspaceId === ACME).length > 0, 3000);
  check('member\'s socket gets workspace:access_revoked { workspaceId }', gotRevoked);
  const revokedAt = m.got('workspace:access_revoked')[0]?.at ?? Date.now();

  await waitFor(() => own.got('run:completed', (p) => p?.runId === slowRun).length > 0, 8000);
  check('control: the owner still received run:completed', own.got('run:completed', (p) => p?.runId === slowRun).length > 0);
  const after = m.events.filter((e) => e.at > revokedAt && ['node:update', 'node:log', 'run:completed', 'queue:stats'].includes(e.event));
  check('after eviction the member received no more run or queue events', after.length === 0, after.map((e) => e.event).join(','));

  const nextRun = (await req('POST', `/workflows/${await makeWorkflow(A, ACME, 'next')}/runs`, { token: A.token, ws: ACME })).body?.runId;
  const again = await m.ack('run:subscribe', { runId: nextRun });
  check('re-subscribing after removal -> not_found', again?.ok === false && again?.error === 'not_found', JSON.stringify(again));
  const wsAgain = await m.ack('workspace:subscribe', { workspaceId: ACME });
  check('workspace room re-join after removal -> not_found', wsAgain?.ok === false, JSON.stringify(wsAgain));
  await waitRun(A, ACME, nextRun);

  // role change
  const V = await join(A, ACME, 'viewer', 'promoted');
  const v = open(V.token); await v.ready; // no subscriptions at all: user:<id> is automatic
  const up = await req('PATCH', `/workspaces/${ACME}/members/${V.user.id}`, { body: { role: 'editor' }, token: A.token });
  check('owner promotes viewer -> editor', ok2xx(up.status), `${up.status}`);
  await waitFor(() => v.got('workspace:role_changed').length > 0, 3000);
  const rc = v.got('workspace:role_changed')[0]?.payload;
  check('workspace:role_changed arrives without any subscribe (user room is automatic)', !!rc);
  check('payload { workspaceId, role, permissions } matches the matrix', rc?.workspaceId === ACME && rc?.role === 'editor'
    && JSON.stringify([...(rc?.permissions || [])].sort()) === JSON.stringify(permissionsFor('editor')), JSON.stringify(rc));
  check('role change does not evict (no access_revoked)', v.got('workspace:access_revoked').length === 0);
  const stillIn = await v.ack('workspace:subscribe', { workspaceId: ACME });
  check('promoted member can still join the workspace room', stillIn?.ok === true);
  m.close(); own.close(); v.close();
}

// ------------------------------------------------------------------ API keys
console.log('\nE. workspace API keys');
let RUN_KEY, EVT_KEY, RUN_KEY_ID;
{
  const bad = await req('POST', `/workspaces/${ACME}/api-keys`, { body: { name: 'x', scopes: ['everything'] }, token: A.token });
  check('unknown scope -> 400', bad.status === 400, `${bad.status}`);
  const none = await req('POST', `/workspaces/${ACME}/api-keys`, { body: { name: 'x', scopes: [] }, token: A.token });
  check('empty scopes -> 400', none.status === 400, `${none.status}`);

  const c = await req('POST', `/workspaces/${ACME}/api-keys`, { body: { name: 'runner', scopes: ['runs:create', 'runs:read'] }, token: A.token });
  RUN_KEY = c.body?.key; RUN_KEY_ID = c.body?.apiKey?.id;
  check('create -> 201 { apiKey, key }', c.status === 201 && c.body?.apiKey && RUN_KEY, `${c.status} ${JSON.stringify(c.body)}`);
  check('key format af_ + 40 base62', /^af_[A-Za-z0-9]{40}$/.test(RUN_KEY || ''), RUN_KEY);
  check('apiKey.prefix is af_ + first 8', c.body?.apiKey?.prefix === RUN_KEY?.slice(0, 11), c.body?.apiKey?.prefix);
  check('create response apiKey has no keyHash', !('keyHash' in (c.body?.apiKey || {})));
  const e = await req('POST', `/workspaces/${ACME}/api-keys`, { body: { name: 'publisher', scopes: ['events:publish'] }, token: A.token });
  EVT_KEY = e.body?.key;

  const list = await req('GET', `/workspaces/${ACME}/api-keys`, { token: A.token });
  const s = JSON.stringify(list.body || []);
  check('list never contains a key or keyHash', list.status === 200 && !s.includes(RUN_KEY) && !s.includes(EVT_KEY) && !s.includes('keyHash'), `${list.status}`);
  const row = (list.body || []).find((k) => k.id === RUN_KEY_ID);
  check('list row { id, name, prefix, scopes, createdBy, lastUsedAt, revokedAt, createdAt }', row && ['name', 'prefix', 'scopes', 'createdBy', 'lastUsedAt', 'revokedAt', 'createdAt'].every((k) => k in row), JSON.stringify(row));
  const dbKey = await db.collection('apikeys').findOne({ _id: new mongoose.Types.ObjectId(RUN_KEY_ID) });
  check('DB stores sha256(key), never the key', dbKey?.keyHash === crypto.createHash('sha256').update(RUN_KEY).digest('hex') && !JSON.stringify(dbKey).includes(RUN_KEY));
  const gList = await req('GET', `/workspaces/${ACME}/api-keys`, { token: G.token });
  check('another tenant cannot list Acme keys (404)', gList.status === 404, `${gList.status}`);
}

// ------------------------------------------------------------------ public run API
console.log('\nF. public run API (/api/w/:slug/...)');
{
  const wf = await makeWorkflow(A, ACME, 'api-triggered', graph(40));
  const r = await req('POST', `/w/${ACME_SLUG}/workflows/${wf}/runs`, { body: { orderId: 7 }, apiKey: RUN_KEY });
  check('POST runs with runs:create -> 202 { runId }', r.status === 202 && r.body?.runId, `${r.status} ${JSON.stringify(r.body)}`);
  const runId = r.body?.runId;
  let pub;
  for (let i = 0; i < 60; i++) {
    pub = await req('GET', `/w/${ACME_SLUG}/runs/${runId}`, { apiKey: RUN_KEY });
    if (['success', 'failed', 'cancelled'].includes(pub.body?.status)) break;
    await sleep(150);
  }
  check('GET run with runs:read reports progress to completion', pub.status === 200 && pub.body?.status === 'success', `${pub.status} ${pub.body?.status}`);
  check('public run payload has per-node status', Array.isArray(pub.body?.nodeResults) && pub.body.nodeResults.every((n) => n.nodeId && n.status));
  const tenantView = (await req('GET', `/runs/${runId}`, { token: A.token, ws: ACME })).body;
  check('run.trigger === "api"', tenantView?.trigger === 'api', tenantView?.trigger);
  const startOut = tenantView?.nodeResults?.find((n) => n.nodeId === 's')?.output;
  check('request body became the Start node input', startOut?.orderId === 7, JSON.stringify(startOut));
  const dbRun = await db.collection('runs').findOne({ _id: new mongoose.Types.ObjectId(runId) });
  check('run records apiKeyId', String(dbRun?.apiKeyId) === String(RUN_KEY_ID), String(dbRun?.apiKeyId));
  const dbKey = await db.collection('apikeys').findOne({ _id: new mongoose.Types.ObjectId(RUN_KEY_ID) });
  check('lastUsedAt was set', !!dbKey?.lastUsedAt);

  const viaHeader = await req('GET', `/w/${ACME_SLUG}/runs/${runId}`, { apiKeyHeader: RUN_KEY });
  check('X-API-Key header is accepted too', viaHeader.status === 200, `${viaHeader.status}`);
  check('no key -> 401', (await req('GET', `/w/${ACME_SLUG}/runs/${runId}`)).status === 401);
  check('unknown key -> 401', (await req('GET', `/w/${ACME_SLUG}/runs/${runId}`, { apiKey: `af_${'x'.repeat(40)}` })).status === 401);
  const scope = await req('POST', `/w/${ACME_SLUG}/workflows/${wf}/runs`, { body: {}, apiKey: EVT_KEY });
  check('key without runs:create -> 403', scope.status === 403, `${scope.status}`);
  const scope2 = await req('GET', `/w/${ACME_SLUG}/runs/${runId}`, { apiKey: EVT_KEY });
  check('key without runs:read -> 403', scope2.status === 403, `${scope2.status}`);
  const cross = await req('POST', `/w/${GLOBEX_SLUG}/workflows/${globexWf}/runs`, { body: {}, apiKey: RUN_KEY });
  check('Acme key on Globex slug -> 404', cross.status === 404, `${cross.status}`);
  const crossRun = await req('GET', `/w/${GLOBEX_SLUG}/runs/${runId}`, { apiKey: RUN_KEY });
  check('Acme key reading via Globex slug -> 404', crossRun.status === 404, `${crossRun.status}`);
  const foreignWf = await req('POST', `/w/${ACME_SLUG}/workflows/${globexWf}/runs`, { body: {}, apiKey: RUN_KEY });
  check('Acme slug + Globex workflow id -> 404', foreignWf.status === 404, `${foreignWf.status}`);
  const unknownSlug = await req('POST', `/w/no-such-slug-${uniq()}/workflows/${wf}/runs`, { body: {}, apiKey: RUN_KEY });
  check('unknown slug -> 404', unknownSlug.status === 404, `${unknownSlug.status}`);

  const slow = await makeWorkflow(A, ACME, 'busy', graph(1500));
  await req('POST', `/w/${ACME_SLUG}/workflows/${slow}/runs`, { body: {}, apiKey: RUN_KEY });
  const busy = await req('POST', `/w/${ACME_SLUG}/workflows/${slow}/runs`, { body: {}, apiKey: RUN_KEY });
  check('already running -> 409', busy.status === 409, `${busy.status}`);

  const rv = await req('DELETE', `/workspaces/${ACME}/api-keys/${RUN_KEY_ID}`, { token: A.token });
  check('revoke -> 204', rv.status === 204, `${rv.status}`);
  const dead = await req('GET', `/w/${ACME_SLUG}/runs/${runId}`, { apiKey: RUN_KEY });
  check('revoked key -> 401', dead.status === 401, `${dead.status}`);
  const listed = ((await req('GET', `/workspaces/${ACME}/api-keys`, { token: A.token })).body || []).find((k) => k.id === RUN_KEY_ID);
  check('revoked key stays listed with revokedAt set', !!listed?.revokedAt);
}

// ------------------------------------------------------------------ events
console.log('\nG. per-workspace events');
{
  const gKey = (await req('POST', `/workspaces/${GLOBEX}/api-keys`, { body: { name: 'pub', scopes: ['events:publish'] }, token: G.token })).body?.key;
  const EVENT = `order.created.${uniq()}`;
  const aWf = await makeWorkflow(A, ACME, 'acme sub');
  const gWf = await makeWorkflow(G, GLOBEX, 'globex sub');
  await req('PUT', `/workflows/${aWf}/event-trigger`, { body: { eventName: EVENT, enabled: true }, token: A.token, ws: ACME });
  await req('PUT', `/workflows/${gWf}/event-trigger`, { body: { eventName: EVENT, enabled: true }, token: G.token, ws: GLOBEX });

  const r = await req('POST', `/w/${ACME_SLUG}/events/${EVENT}`, { body: { n: 1 }, apiKey: EVT_KEY });
  check('Acme publish -> 202 triggering exactly Acme\'s subscriber', r.status === 202 && r.body?.triggered?.length === 1, `${r.status} ${JSON.stringify(r.body)}`);
  await sleep(600);
  const aRuns = (await req('GET', `/workflows/${aWf}/runs`, { token: A.token, ws: ACME })).body || [];
  const gRuns = (await req('GET', `/workflows/${gWf}/runs`, { token: G.token, ws: GLOBEX })).body || [];
  check('Acme workflow ran with trigger=event', aRuns.length === 1 && aRuns[0].trigger === 'event', `${aRuns.length}`);
  check('Globex subscriber to the same name did NOT run', gRuns.length === 0, `${gRuns.length}`);
  const r2 = await req('POST', `/w/${GLOBEX_SLUG}/events/${EVENT}`, { body: { n: 2 }, apiKey: gKey });
  check('Globex publish fires only Globex', r2.status === 202 && r2.body?.triggered?.length === 1, JSON.stringify(r2.body));
  await sleep(600);
  check('Acme run count unchanged after Globex publish', ((await req('GET', `/workflows/${aWf}/runs`, { token: A.token, ws: ACME })).body || []).length === 1);

  const cross = await req('POST', `/w/${GLOBEX_SLUG}/events/${EVENT}`, { body: {}, apiKey: EVT_KEY });
  check('Acme key on Globex slug -> 404', cross.status === 404, `${cross.status}`);
  const empty = await req('POST', `/w/${ACME_SLUG}/events/nobody.${uniq()}`, { body: {}, apiKey: EVT_KEY });
  check('zero subscribers -> 202 { triggered: [] }', empty.status === 202 && Array.isArray(empty.body?.triggered) && empty.body.triggered.length === 0, JSON.stringify(empty.body));
  const badName = await req('POST', `/w/${ACME_SLUG}/events/${encodeURIComponent('bad name!')}`, { body: {}, apiKey: EVT_KEY });
  check('invalid event name -> 400', badName.status === 400, `${badName.status}`);
  const old = await req('POST', `/events/${EVENT}`, { body: {} });
  check('old /api/events/:name -> 410 with newUrl', old.status === 410 && String(old.body?.newUrl || '').includes('/api/w/'), `${old.status} ${JSON.stringify(old.body)}`);
}

for (const s of sockets) s.close();
await mongoose.disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
