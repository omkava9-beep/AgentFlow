/**
 * Tenancy check for spec/22 - the acceptance criteria as a runnable script.
 * Needs a running server; the migration section uses its own throwaway database.
 *
 *   PORT=4500 MONGODB_URI=...-check npm run dev                        # terminal 1
 *   BASE=http://localhost:4500/api MONGODB_URI=... npm run check:tenancy # terminal 2
 *
 * MONGODB_URI must be the server's database: several checks confirm, straight
 * from MongoDB, that documents landed in (or were removed from) the right
 * workspace. The last section is a static scan of the controllers - the "every
 * tenant query goes through tenancy/scoped.js" rule, enforced mechanically.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { toolCacheKey } from '../cache/TTLCache.js';

const B = process.env.BASE || 'http://localhost:4500/api';
const DB_URI = process.env.MONGODB_URI;
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`); ok ? pass++ : fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const oid = (v) => new mongoose.Types.ObjectId(String(v));

if (!DB_URI) {
  console.error('MONGODB_URI must be set to the running server\'s database');
  process.exit(1);
}

/** `ws` is sent as X-Workspace-Id; pass `null` to omit it on purpose. */
async function req(method, p, { body, token, ws } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (ws) headers['X-Workspace-Id'] = String(ws);
  const res = await fetch(B + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, body: json };
}

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
async function register(tag, name) {
  const r = await req('POST', '/auth/register', { body: { email: `${tag}${uniq()}@e.com`, password: 'password123', name } });
  return { token: r.body?.token, user: r.body?.user, workspaces: r.body?.workspaces || [], ws: r.body?.workspaces?.[0]?.id, raw: r };
}

const N = (id, type, config) => ({ id, type, position: { x: 0, y: 0 }, data: { config } });
const TERMINAL = ['success', 'failed', 'cancelled'];
const simpleGraph = {
  nodes: [N('s', 'start', { label: 'Start' }), N('e', 'end', { label: 'End' })],
  edges: [{ id: 'e1', source: 's', target: 'e' }],
};
const weatherGraph = {
  nodes: [
    N('s', 'start', { label: 'Start' }),
    N('t', 'tool', { label: 'Weather', toolType: 'fake-weather', toolConfig: { city: `Oslo-${uniq()}` }, mockOverrides: { failureRate: 0, latencyMs: [5, 15] } }),
    N('e', 'end', { label: 'End' }),
  ],
  edges: [{ id: 'e1', source: 's', target: 't' }, { id: 'e2', source: 't', target: 'e' }],
};

async function makeWorkflow(u, ws, name, graph = simpleGraph) {
  const r = await req('POST', '/workflows', { body: { name }, token: u.token, ws });
  const id = r.body?._id;
  await req('PUT', `/workflows/${id}`, { body: graph, token: u.token, ws });
  // spec/30: triggers and share links use the PUBLISHED version, so fixtures
  // are published the way a user would press Publish after building them.
  await req('POST', `/workflows/${id}/publish`, { body: { acknowledgeWarnings: true }, token: u.token, ws });
  return id;
}
async function waitRun(u, ws, runId, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const r = await req('GET', `/runs/${runId}`, { token: u.token, ws });
    if (r.body && TERMINAL.includes(r.body.status)) return r.body;
    await sleep(150);
  }
  return (await req('GET', `/runs/${runId}`, { token: u.token, ws })).body;
}
async function runToEnd(u, ws, wfId) {
  const r = await req('POST', `/workflows/${wfId}/runs`, { token: u.token, ws });
  return waitRun(u, ws, r.body?.runId);
}

const conn = await mongoose.createConnection(DB_URI).asPromise();
const col = (name) => conn.db.collection(name);

// ------------------------------------------------------------------ A
console.log('A. registration creates a personal workspace');
const alice = await register('ta', 'Alice');
{
  check('register 201 with token', alice.raw.status === 201 && Boolean(alice.token), String(alice.raw.status));
  const ws = alice.workspaces;
  check('response lists exactly one workspace', ws.length === 1, JSON.stringify(ws));
  check('it is personal and alice is owner', ws[0]?.personal === true && ws[0]?.role === 'owner', JSON.stringify(ws[0]));
  check('it has a slug and permissions list', /^[a-z0-9-]{3,40}$/.test(ws[0]?.slug || '') && Array.isArray(ws[0]?.permissions), `${ws[0]?.slug}`);
  check('user carries the display name', alice.user?.name === 'Alice', JSON.stringify(alice.user));
  const me = await req('GET', '/auth/me', { token: alice.token });
  check('/me lists the personal workspace', me.body?.workspaces?.some((w) => w.id === alice.ws && w.personal), JSON.stringify(me.body?.workspaces));
  const m = await col('memberships').findOne({ workspaceId: oid(alice.ws), userId: oid(alice.user.id) });
  check('owner membership stored', m?.role === 'owner');
  const noName = await register('tn');
  check('name defaults from the email when omitted', Boolean(noName.user?.name) && noName.user.name.startsWith('tn'), JSON.stringify(noName.user));
}

// ------------------------------------------------------------------ B
console.log('\nB. data isolation across workspaces');
const bob = await register('tb', 'Bob');
const ws1 = alice.ws;
const created = await req('POST', '/workspaces', { body: { name: `Acme ${uniq()}` }, token: alice.token });
const ws2 = created.body?.id || created.body?._id;
check('alice creates a second workspace (201, owner)', created.status === 201 && Boolean(ws2), `${created.status} ${JSON.stringify(created.body)}`);

const wfA1 = await makeWorkflow(alice, ws1, 'A1 workflow');
const wfA2 = await makeWorkflow(alice, ws2, 'A2 workflow');
const wfB = await makeWorkflow(bob, bob.ws, 'B workflow');
const runA1 = await runToEnd(alice, ws1, wfA1);
const runA2 = await runToEnd(alice, ws2, wfA2);
const runB = await runToEnd(bob, bob.ws, wfB);
check('seed runs completed', [runA1, runA2, runB].every((r) => r?.status === 'success'), [runA1, runA2, runB].map((r) => r?.status).join('/'));
const tplA1 = (await req('POST', '/templates', { body: { workflowId: wfA1, name: 'A1 template' }, token: alice.token, ws: ws1 })).body?._id;
check('custom template created in ws1', Boolean(tplA1));

const listIds = async (u, ws) => ((await req('GET', '/workflows', { token: u.token, ws })).body || []).map((w) => w._id);
let ids = await listIds(alice, ws1);
check('ws1 list = only ws1 workflows', ids.includes(wfA1) && !ids.includes(wfA2) && !ids.includes(wfB), JSON.stringify(ids));
ids = await listIds(alice, ws2);
check('ws2 list = only ws2 workflows', ids.includes(wfA2) && !ids.includes(wfA1) && !ids.includes(wfB), JSON.stringify(ids));
ids = await listIds(bob, bob.ws);
check("bob's list has none of alice's", ids.includes(wfB) && !ids.includes(wfA1) && !ids.includes(wfA2), JSON.stringify(ids));

const tpl = async (u, ws) => ((await req('GET', '/templates', { token: u.token, ws })).body || []).map((t) => t._id);
check('ws1 templates include its custom template', (await tpl(alice, ws1)).includes(tplA1));
check('ws2 templates do not', !(await tpl(alice, ws2)).includes(tplA1));
check("bob's templates do not", !(await tpl(bob, bob.ws)).includes(tplA1));

const summary = async (u, ws) => (await req('GET', '/analytics/summary?days=30', { token: u.token, ws })).body;
check('ws1 analytics counts only ws1 runs (1)', (await summary(alice, ws1))?.totalRuns === 1);
check('ws2 analytics counts only ws2 runs (1)', (await summary(alice, ws2))?.totalRuns === 1);
check("bob's analytics counts only his run (1)", (await summary(bob, bob.ws))?.totalRuns === 1);
const runsList = async (u, ws, wf) => (await req('GET', `/workflows/${wf}/runs`, { token: u.token, ws })).body;
check('run history of a ws1 workflow lists its run', (await runsList(alice, ws1, wfA1))?.some((r) => r.id === runA1._id));

const runDocs = await col('runs').find({ _id: { $in: [runA1, runA2, runB].map((r) => oid(r._id)) } }).toArray();
const wsOf = Object.fromEntries(runDocs.map((r) => [String(r._id), String(r.workspaceId)]));
check('runs are stored with their workflow\'s workspaceId',
  wsOf[runA1._id] === ws1 && wsOf[runA2._id] === ws2 && wsOf[runB._id] === bob.ws, JSON.stringify(wsOf));
check('manual runs record triggeredBy, not ownerId',
  runDocs.every((r) => r.ownerId === undefined) && String(runDocs.find((r) => String(r._id) === runA1._id)?.triggeredBy) === alice.user.id);
const wfDoc = await col('workflows').findOne({ _id: oid(wfA1) });
check('workflows store workspaceId + createdBy, no ownerId',
  String(wfDoc?.workspaceId) === ws1 && String(wfDoc?.createdBy) === alice.user.id && wfDoc?.ownerId === undefined);

// ------------------------------------------------------------------ C
console.log('\nC. route inventory: every tenant route 404s on a foreign resource');
{
  // A long-running run so cancel has something to target.
  const slow = {
    nodes: [N('s', 'start', { label: 'Start' }), N('t', 'tool', { label: 'Slow', toolType: 'calculator', toolConfig: { expression: `${uniq()}+1` }, mockOverrides: { failureRate: 0, latencyMs: [3000, 3100] } }), N('e', 'end', { label: 'End' })],
    edges: [{ id: 'e1', source: 's', target: 't' }, { id: 'e2', source: 't', target: 'e' }],
  };
  const wfSlow = await makeWorkflow(alice, ws1, 'slow', slow);
  const slowRun = (await req('POST', `/workflows/${wfSlow}/runs`, { token: alice.token, ws: ws1 })).body?.runId;

  const as = { token: bob.token, ws: bob.ws };
  const inventory = [
    ['GET', `/workflows/${wfA1}`],
    ['PUT', `/workflows/${wfA1}`, { name: 'hijacked' }],
    ['DELETE', `/workflows/${wfA1}`],
    ['POST', `/workflows/${wfA1}/runs`],
    ['GET', `/workflows/${wfA1}/runs`],
    ['PUT', `/workflows/${wfA1}/schedule`, { cronExpression: '0 3 * * *', enabled: true }],
    ['DELETE', `/workflows/${wfA1}/schedule`],
    ['POST', `/workflows/${wfA1}/webhook/regenerate`],
    ['PUT', `/workflows/${wfA1}/webhook`, { enabled: true }],
    ['PUT', `/workflows/${wfA1}/event-trigger`, { eventName: 'x.y', enabled: true }],
    ['DELETE', `/workflows/${wfA1}/event-trigger`],
    ['POST', `/workflows/${wfA1}/share`],
    ['DELETE', `/workflows/${wfA1}/share`],
    ['GET', `/runs/${runA1._id}`],
    ['POST', `/runs/${slowRun}/cancel`],
    ['POST', `/templates/${tplA1}/use`, {}],
    ['POST', '/templates', { workflowId: wfA1, name: 'stolen' }],
  ];
  for (const [method, p, body] of inventory) {
    const r = await req(method, p, { ...as, body });
    check(`${method} ${p.replace(/[0-9a-f]{24}/g, ':id')} → 404`, r.status === 404, `${r.status} ${r.body?.error || ''}`);
  }

  const after = await col('workflows').findOne({ _id: oid(wfA1) });
  check("alice's workflow survived bob's PUT/DELETE unchanged", after?.name === 'A1 workflow' && after?.webhook?.token == null && !after?.schedule?.enabled && !after?.shareToken);
  const slowNow = (await req('GET', `/runs/${slowRun}`, { token: alice.token, ws: ws1 })).body;
  check("alice's run was not cancelled by bob", slowNow?.status !== 'cancelled', slowNow?.status);

  const own = { token: bob.token };
  let r = await req('GET', '/workflows', own);
  check('missing X-Workspace-Id → 400', r.status === 400, `${r.status} ${r.body?.error}`);
  r = await req('GET', '/workflows', { ...own, ws: 'not-an-object-id' });
  check('malformed X-Workspace-Id → 404', r.status === 404, `${r.status} ${r.body?.error}`);
  r = await req('GET', '/workflows', { ...own, ws: ws1 });
  check("alice's workspace id in bob's header → 404", r.status === 404 && /workspace not found/i.test(r.body?.error || ''), `${r.status} ${r.body?.error}`);
  r = await req('GET', '/workflows', { ...own, ws: new mongoose.Types.ObjectId().toString() });
  check('nonexistent workspace id → same 404', r.status === 404 && /workspace not found/i.test(r.body?.error || ''), `${r.status}`);
  r = await req('GET', `/workflows/not-an-id`, as);
  check('malformed resource id → 404, not 500', r.status === 404, String(r.status));
  r = await req('GET', '/analytics/summary', { ...own, ws: ws1 });
  check('foreign analytics → 404', r.status === 404, String(r.status));
  r = await req('GET', '/templates', { ...own, ws: ws1 });
  check('foreign templates list → 404', r.status === 404, String(r.status));
  r = await req('GET', `/workflows/${wfA1}`, { token: alice.token, ws: ws2 });
  check('own resource under the wrong one of your own workspaces → 404', r.status === 404, String(r.status));
  r = await req('GET', '/integrations', { token: bob.token });
  check('GET /integrations stays auth-only (no workspace header needed)', r.status === 200, String(r.status));

  await req('POST', `/runs/${slowRun}/cancel`, { token: alice.token, ws: ws1 });
}

// ------------------------------------------------------------------ D
console.log('\nD. workspace CRUD');
{
  const name = `Globex ${uniq()}`;
  let r = await req('POST', '/workspaces', { body: { name }, token: bob.token });
  const g = r.body;
  const gid = g?.id || g?._id;
  check('create 201', r.status === 201 && g?.name === name, `${r.status}`);
  check('creator is owner', g?.role === undefined || g?.role === 'owner', String(g?.role));
  r = await req('GET', '/workspaces', { token: bob.token });
  check('listed for the creator with role owner', r.body?.some((w) => w.id === gid && w.role === 'owner'));
  r = await req('GET', '/workspaces', { token: alice.token });
  check('not listed for others', !r.body?.some((w) => w.id === gid));

  r = await req('PATCH', `/workspaces/${gid}`, { body: { name: 'Globex Renamed' }, token: bob.token, ws: gid });
  check('rename 200', r.status === 200 && r.body?.name === 'Globex Renamed', `${r.status} ${r.body?.name}`);
  const newSlug = `globex-${uniq()}`.slice(0, 30);
  r = await req('PATCH', `/workspaces/${gid}`, { body: { slug: newSlug }, token: bob.token, ws: gid });
  check('slug change 200', r.status === 200 && r.body?.slug === newSlug, `${r.status} ${r.body?.slug}`);
  r = await req('PATCH', `/workspaces/${gid}`, { body: { slug: 'Bad Slug!' }, token: bob.token, ws: gid });
  check('invalid slug → 400', r.status === 400, String(r.status));
  r = await req('PATCH', `/workspaces/${gid}`, { body: { slug: 'settings' }, token: bob.token, ws: gid });
  check('reserved slug → 400', r.status === 400, String(r.status));
  r = await req('PATCH', `/workspaces/${gid}`, { body: { slug: alice.workspaces[0].slug }, token: bob.token, ws: gid });
  check('taken slug → 409', r.status === 409, String(r.status));
  r = await req('PATCH', `/workspaces/${gid}`, { body: { name: 'pwned' }, token: alice.token, ws: gid });
  check('non-member PATCH → 404', r.status === 404, String(r.status));

  r = await req('GET', `/workspaces/by-slug/${newSlug}`, { token: bob.token });
  check('by-slug for a member → 200 with role', r.status === 200 && r.body?.role === 'owner', `${r.status}`);
  r = await req('GET', `/workspaces/by-slug/${newSlug}`, { token: alice.token });
  check('by-slug for a non-member → 404', r.status === 404, String(r.status));
  r = await req('GET', `/workspaces/by-slug/no-such-${uniq()}`, { token: alice.token });
  check('by-slug unknown → same 404', r.status === 404, String(r.status));

  r = await req('DELETE', `/workspaces/${bob.ws}`, { body: { confirmName: bob.workspaces[0].name }, token: bob.token, ws: bob.ws });
  check('deleting a personal workspace → 400', r.status === 400, String(r.status));

  // Something to cascade: a workflow with a per-second schedule, and a run.
  const doomed = await makeWorkflow(bob, gid, 'doomed');
  await runToEnd(bob, gid, doomed);
  r = await req('PUT', `/workflows/${doomed}/schedule`, { body: { cronExpression: '* * * * * *', enabled: true }, token: bob.token, ws: gid });
  const scheduled = r.status === 200;
  if (!scheduled) console.log(`    (per-second cron rejected with ${r.status}; schedule assertion is skipped)`);
  await sleep(1200);

  r = await req('DELETE', `/workspaces/${gid}`, { body: { confirmName: 'wrong name' }, token: bob.token, ws: gid });
  check('wrong confirmName → 400', r.status === 400, String(r.status));
  r = await req('DELETE', `/workspaces/${gid}`, { body: { confirmName: 'Globex Renamed' }, token: alice.token, ws: gid });
  check('non-member delete → 404', r.status === 404, String(r.status));
  r = await req('DELETE', `/workspaces/${gid}`, { body: { confirmName: 'Globex Renamed' }, token: bob.token, ws: gid });
  check('delete → 204', r.status === 204, `${r.status} ${r.body?.error || ''}`);

  const gidO = oid(gid);
  check('workspace document removed', !(await col('workspaces').findOne({ _id: gidO })));
  check('memberships removed', (await col('memberships').countDocuments({ workspaceId: gidO })) === 0);
  check('workflows removed', (await col('workflows').countDocuments({ workspaceId: gidO })) === 0);
  check('runs removed', (await col('runs').countDocuments({ workspaceId: gidO })) === 0);
  if (scheduled) {
    await sleep(2200);
    check('no scheduled run appears after delete (schedule unregistered)', (await col('runs').countDocuments({ workflowId: oid(doomed) })) === 0);
  }
  r = await req('GET', '/workflows', { token: bob.token, ws: gid });
  check('deleted workspace id → 404', r.status === 404, String(r.status));
  check('server still healthy', (await req('GET', '/health')).status === 200);
}

// ------------------------------------------------------------------ E
console.log('\nE. capability-token paths still work');
{
  const hooked = await makeWorkflow(alice, ws2, 'hooked');
  const hook = (await req('POST', `/workflows/${hooked}/webhook/regenerate`, { token: alice.token, ws: ws2 })).body;
  let r = await req('POST', `/hooks/${hook?.token}`, { body: { from: 'outside' } });
  check('webhook (no auth, no header) → 202', r.status === 202 && Boolean(r.body?.runId), `${r.status}`);
  const hookRun = r.body?.runId && await waitRun(alice, ws2, r.body.runId);
  check('webhook run finished in the workflow\'s workspace', hookRun?.status === 'success');
  const hookDoc = r.body?.runId && await col('runs').findOne({ _id: oid(r.body.runId) });
  check('webhook run stored with workspaceId and no triggeredBy', String(hookDoc?.workspaceId) === ws2 && hookDoc?.triggeredBy == null, `${hookDoc?.workspaceId}/${hookDoc?.triggeredBy}`);

  const share = (await req('POST', `/workflows/${hooked}/share`, { token: alice.token, ws: ws2 })).body;
  r = await req('GET', `/shared/${share?.shareToken}`);
  check('share link works without auth or header', r.status === 200 && r.body?.workflow?.name === 'hooked', String(r.status));
  check('shared payload leaks no workspaceId/createdBy', !/workspaceId|createdBy|ownerId/.test(JSON.stringify(r.body || {})));
}

// ------------------------------------------------------------------ F
console.log('\nF. cache isolation');
{
  const k1 = toolCacheKey('ws-one', 'fake-weather', { city: 'Oslo' }, { a: 1 });
  const k2 = toolCacheKey('ws-two', 'fake-weather', { city: 'Oslo' }, { a: 1 });
  check('unit: identical call in two workspaces → different keys', k1 !== k2, `${k1} | ${k2}`);
  check('unit: same workspace → same key', k1 === toolCacheKey('ws-one', 'fake-weather', { city: 'Oslo' }, { a: 1 }));

  const graph = JSON.parse(JSON.stringify(weatherGraph));
  const w1 = await makeWorkflow(alice, ws1, 'cache 1', graph);
  const w2 = await makeWorkflow(alice, ws2, 'cache 2', graph);
  const r1 = await runToEnd(alice, ws1, w1);
  const r1b = await runToEnd(alice, ws1, w1);
  const r2 = await runToEnd(alice, ws2, w2);
  const cachedOf = (run) => run?.nodeResults?.find((x) => x.nodeId === 't')?.cached;
  check('first run in ws1 is a miss', cachedOf(r1) !== true);
  check('repeat in ws1 is a hit (the cache is on)', cachedOf(r1b) === true, String(cachedOf(r1b)));
  check('identical call in ws2 is NOT served from ws1\'s cache', r2?.status === 'success' && cachedOf(r2) !== true, `${r2?.status} cached=${cachedOf(r2)}`);
}

await conn.close();

// ------------------------------------------------------------------ G
console.log('\nG. migration of phase-2 data (throwaway database)');
{
  const MIG_URI = `${DB_URI.replace(/\/+$/, '')}-migratecheck`;
  let migrateWorkspaces;
  try {
    ({ migrateWorkspaces } = await import('./migrateWorkspaces.js'));
  } catch (err) {
    check('migrateWorkspaces.js importable', false, err.message);
  }
  if (typeof migrateWorkspaces === 'function') {
    await mongoose.connect(MIG_URI);
    const db = mongoose.connection.db;
    await db.dropDatabase();
    const u1 = new mongoose.Types.ObjectId(), u2 = new mongoose.Types.ObjectId();
    const w1 = new mongoose.Types.ObjectId(), w2 = new mongoose.Types.ObjectId();
    const now = new Date();
    await db.collection('users').insertMany([
      { _id: u1, email: 'legacy1@e.com', passwordHash: 'x', createdAt: now },
      { _id: u2, email: 'legacy2@e.com', passwordHash: 'x', createdAt: now },
    ]);
    await db.collection('workflows').insertMany([
      { _id: w1, ownerId: u1, name: 'legacy wf 1', nodes: [], edges: [], createdAt: now, updatedAt: now },
      { _id: w2, ownerId: u2, name: 'legacy wf 2', nodes: [], edges: [], createdAt: now, updatedAt: now },
    ]);
    const rManual = new mongoose.Types.ObjectId(), rSched = new mongoose.Types.ObjectId(), rU2 = new mongoose.Types.ObjectId();
    await db.collection('runs').insertMany([
      { _id: rManual, workflowId: w1, ownerId: u1, status: 'success', trigger: 'manual', nodeResults: [], createdAt: now },
      { _id: rSched, workflowId: w1, ownerId: u1, status: 'success', trigger: 'schedule', nodeResults: [], createdAt: now },
      { _id: rU2, workflowId: w2, ownerId: u2, status: 'failed', trigger: 'manual', nodeResults: [], createdAt: now },
    ]);
    const tBuiltIn = new mongoose.Types.ObjectId(), tOwned = new mongoose.Types.ObjectId();
    await db.collection('templates').insertMany([
      { _id: tBuiltIn, ownerId: null, name: 'Built-in', nodes: [], edges: [], createdAt: now },
      { _id: tOwned, ownerId: u1, name: 'Mine', nodes: [], edges: [], createdAt: now },
    ]);
    const mRec = new mongoose.Types.ObjectId();
    await db.collection('mockrecords').insertOne({ _id: mRec, ownerId: u1, runId: rManual, collectionName: 'orders', document: { a: 1 }, createdAt: now });

    const silent = () => {};
    let migErr = null;
    try { await migrateWorkspaces({ log: silent }); } catch (err) { migErr = err; }
    check('first migration run completes', !migErr, migErr?.message);

    const personalOf = async (u) => {
      const mems = await db.collection('memberships').find({ userId: u }).toArray();
      const wss = await db.collection('workspaces').find({ _id: { $in: mems.map((m) => m.workspaceId) }, personal: true }).toArray();
      return { mems, wss };
    };
    const p1 = await personalOf(u1), p2 = await personalOf(u2);
    check('each user has exactly one personal workspace', p1.wss.length === 1 && p2.wss.length === 1, `${p1.wss.length}/${p2.wss.length}`);
    check('…with an owner membership', p1.mems.some((m) => m.role === 'owner') && p2.mems.some((m) => m.role === 'owner'));
    const ws1Id = String(p1.wss[0]?._id), ws2Id = String(p2.wss[0]?._id);

    const wfs = await db.collection('workflows').find().toArray();
    const wfById = Object.fromEntries(wfs.map((w) => [String(w._id), w]));
    check('workflows moved into their owner\'s personal workspace', String(wfById[w1]?.workspaceId) === ws1Id && String(wfById[w2]?.workspaceId) === ws2Id);
    check('workflow ownerId renamed to createdBy', wfs.every((w) => w.ownerId === undefined) && String(wfById[w1]?.createdBy) === String(u1));

    const runs = Object.fromEntries((await db.collection('runs').find().toArray()).map((r) => [String(r._id), r]));
    check('runs carry workspaceId', String(runs[rManual]?.workspaceId) === ws1Id && String(runs[rU2]?.workspaceId) === ws2Id);
    check('manual run → triggeredBy = old owner', String(runs[rManual]?.triggeredBy) === String(u1));
    check('schedule run → triggeredBy null', runs[rSched]?.triggeredBy === null, String(runs[rSched]?.triggeredBy));
    check('run ownerId gone', Object.values(runs).every((r) => r.ownerId === undefined));

    const tpls = Object.fromEntries((await db.collection('templates').find().toArray()).map((t) => [String(t._id), t]));
    check('built-in template keeps workspaceId null', tpls[tBuiltIn]?.workspaceId === null, String(tpls[tBuiltIn]?.workspaceId));
    check('owned template → owner\'s workspace + createdBy', String(tpls[tOwned]?.workspaceId) === ws1Id && String(tpls[tOwned]?.createdBy) === String(u1));
    check('template ownerId gone', Object.values(tpls).every((t) => t.ownerId === undefined));

    const rec = await db.collection('mockrecords').findOne({ _id: mRec });
    check('mock record → workspaceId, ownerId dropped', String(rec?.workspaceId) === ws1Id && rec?.ownerId === undefined);

    const snapshot = async () => {
      const out = {};
      for (const c of ['users', 'workspaces', 'memberships', 'workflows', 'runs', 'templates', 'mockrecords']) {
        out[c] = await db.collection(c).find().sort({ _id: 1 }).toArray();
      }
      return JSON.stringify(out);
    };
    const before = await snapshot();
    migErr = null;
    try { await migrateWorkspaces({ log: silent }); } catch (err) { migErr = err; }
    check('second migration run completes', !migErr, migErr?.message);
    check('second run changes nothing (idempotent)', (await snapshot()) === before);

    await db.dropDatabase();
    await mongoose.disconnect();
  }
}

// ------------------------------------------------------------------ H
console.log('\nH. static scan: controllers reach tenant data only through tenancy/scoped.js');
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.join(here, '..', 'controllers');
  const TENANT = /\b(Workflow|Run|Template|SandboxRecord)\.(findById|find|findOne|aggregate|countDocuments|updateOne|updateMany|deleteMany|deleteOne|findOneAndUpdate|findByIdAndUpdate|findByIdAndDelete)\(/;
  const SAFE = /scopedFilter\(|findInWorkspace\(|workspaceId/;
  const violations = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    const lines = source.split('\n');
    // Filters built ahead of time (`const runMatch = scopedFilter(req, …)`) and
    // then passed by name, e.g. `{ $match: runMatch }`, count as scoped too.
    const scopedNames = [...source.matchAll(/(?:const|let)\s+(\w+)\s*=[^;\n]*scopedFilter\(/g)].map((m) => m[1]);
    const usesScopedName = (text) => scopedNames.some((n) => new RegExp(`\\b${n}\\b`).test(text));
    lines.forEach((line, i) => {
      if (!TENANT.test(line)) return;
      if (/\/\/ tenancy: capability lookup/.test(line) || /\/\/ tenancy: capability lookup/.test(lines[i - 1] || '')) return;
      const statement = lines.slice(i, i + 4).join('\n');
      if (SAFE.test(statement) || usesScopedName(statement)) return;
      violations.push(`${file}:${i + 1}  ${line.trim()}`);
    });
  }
  check(`no unscoped tenant queries in controllers (${violations.length} found)`, violations.length === 0);
  for (const v of violations) console.log(`      ${v}`);
}

// ------------------------------------------------------------ I: delete cascade
// spec/22: every collection that carries a workspaceId must be removed when its
// workspace is. A spec that adds a tenant model and forgets the cascade list
// leaves orphaned tenant data behind - this catches it the moment it happens.
console.log('\nI. every model with a workspaceId is in the workspace-delete cascade');
{
  const modelsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'models');
  for (const file of fs.readdirSync(modelsDir).filter((f) => f.endsWith('.js'))) {
    await import(path.join(modelsDir, file));
  }
  const { TENANT_MODELS } = await import('../tenancy/deleteWorkspace.js');
  const cascaded = new Set(TENANT_MODELS.map(({ model }) => model.modelName));
  // AuditEvent is purged through its own sanctioned path (spec/34), and the
  // Workspace document itself is deleted last.
  const handledSeparately = new Set(['AuditEvent', 'Workspace']);
  const missing = mongoose.modelNames().filter((name) =>
    mongoose.model(name).schema.path('workspaceId') && !cascaded.has(name) && !handledSeparately.has(name));
  check(`all ${mongoose.modelNames().length} models checked; none missing from TENANT_MODELS`, missing.length === 0, missing.join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
