/**
 * Versioning check for spec/30 - draft vs published, as a runnable script.
 * Needs a running server and its database:
 *
 *   PORT=4500 MONGODB_URI=...-check npm run dev                           # terminal 1
 *   BASE=http://localhost:4500/api MONGODB_URI=... npm run check:versions  # terminal 2
 *
 * Distinguishing "ran the draft" from "ran the published version" uses a
 * calculator node whose expression differs between the two, so the run's own
 * output says which graph executed - not just the recorded versionNumber.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { io } from 'socket.io-client';
import { validateGraph } from '../engine/validateGraph.js';

const B = process.env.BASE || 'http://localhost:4500/api';
const DB_URI = process.env.MONGODB_URI;
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`); ok ? pass++ : fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok2xx = (s) => s >= 200 && s < 300;
const socketUrl = () => B.replace(/\/api\/?$/, '');

if (!DB_URI) {
  console.error("MONGODB_URI must be set to the running server's database");
  process.exit(1);
}

async function req(method, p, { body, token, ws, headers: extra = {} } = {}) {
  const headers = { ...extra };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (ws) headers['X-Workspace-Id'] = String(ws);
  const res = await fetch(B + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, body: json };
}

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const newEmail = (tag) => `${tag}${uniq()}@versions.dev`;
async function register(tag, email = newEmail(tag)) {
  const r = await req('POST', '/auth/register', { body: { email, password: 'password123', name: tag } });
  const w = r.body?.workspaces?.[0];
  return { token: r.body?.token, user: r.body?.user, email, ws: w?.id, slug: w?.slug };
}
async function join(owner, ws, role, tag = role) {
  const email = newEmail(tag);
  const inv = await req('POST', `/workspaces/${ws}/invitations`, { body: { email, role }, token: owner.token });
  const u = await register(tag, email);
  const token = String(inv.body?.inviteUrl || '').split('/invite/').pop();
  await req('POST', `/invitations/${token}/accept`, { token: u.token });
  return u;
}

const N = (id, type, config = {}, x = 0) => ({ id, type, position: { x, y: 0 }, data: { config: { label: id, ...config } } });
const calc = (expression) => N('calc', 'tool', { integration: 'builtin', action: 'calculator', connectionId: null, params: { expression }, mockOverrides: { failureRate: 0 } }, 200);
const calcGraph = (expression) => ({
  nodes: [N('s', 'start'), calc(expression), N('e', 'end', {}, 400)],
  edges: [{ id: 'e1', source: 's', target: 'calc' }, { id: 'e2', source: 'calc', target: 'e' }],
});

async function makeWorkflow(u, name, graph) {
  const r = await req('POST', '/workflows', { body: { name }, token: u.token, ws: u.ws });
  const id = r.body?._id;
  if (graph) {
    const put = await req('PUT', `/workflows/${id}`, { body: graph, token: u.token, ws: u.ws });
    if (!ok2xx(put.status)) console.log('      makeWorkflow PUT failed', put.status, put.body);
  }
  return id;
}
const publish = (u, id, body = {}) => req('POST', `/workflows/${id}/publish`, { body, token: u.token, ws: u.ws });
const getWf = (u, id) => req('GET', `/workflows/${id}`, { token: u.token, ws: u.ws });

async function waitRun(u, runId, tries = 80) {
  for (let i = 0; i < tries; i++) {
    const r = await req('GET', `/runs/${runId}`, { token: u.token, ws: u.ws });
    if (['success', 'failed', 'cancelled'].includes(r.body?.status)) return r.body;
    await sleep(150);
  }
  return (await req('GET', `/runs/${runId}`, { token: u.token, ws: u.ws })).body;
}
const calcOut = (run) => (run?.nodeResults || []).find((n) => n.nodeId === 'calc')?.output?.expression;

async function latestRun(u, workflowId, after = 0) {
  const r = await req('GET', `/workflows/${workflowId}/runs`, { token: u.token, ws: u.ws });
  return (r.body || []).find((x) => new Date(x.startedAt || 0).getTime() >= after || !x.startedAt);
}

await mongoose.connect(DB_URI);
const db = mongoose.connection.db;
const owner = await register('owner');
const viewer = await join(owner, owner.ws, 'viewer');

// ------------------------------------------------------------------ A
console.log('A. publish creates immutable numbered versions; hash ignores layout and name');
let A;
{
  A = await makeWorkflow(owner, 'Versioned', calcGraph('1+1'));
  let wf = await getWf(owner, A);
  check('new workflow is unpublished with changes pending', wf.body?.publishedVersion === null && wf.body?.hasUnpublishedChanges === true, JSON.stringify({ v: wf.body?.publishedVersion, u: wf.body?.hasUnpublishedChanges }));
  const p1 = await publish(owner, A, { message: 'first' });
  check('publish → 201 v1', p1.status === 201 && p1.body?.version?.version === 1, `${p1.status} ${JSON.stringify(p1.body)}`);
  wf = await getWf(owner, A);
  check('workflow points at v1, no unpublished changes', wf.body?.publishedVersion === 1 && wf.body?.hasUnpublishedChanges === false);
  const again = await publish(owner, A);
  check('publishing an unchanged draft → 409 Nothing to publish', again.status === 409 && /nothing to publish/i.test(again.body?.error || ''), `${again.status}`);

  const moved = calcGraph('1+1');
  moved.nodes[1].position = { x: 999, y: 555 };
  await req('PUT', `/workflows/${A}`, { body: { ...moved, name: 'Renamed only' }, token: owner.token, ws: owner.ws });
  wf = await getWf(owner, A);
  check('moving a node and renaming does NOT set hasUnpublishedChanges', wf.body?.hasUnpublishedChanges === false);

  await req('PUT', `/workflows/${A}`, { body: calcGraph('40+2'), token: owner.token, ws: owner.ws });
  wf = await getWf(owner, A);
  check('changing a config value sets hasUnpublishedChanges', wf.body?.hasUnpublishedChanges === true);
  const list = await req('GET', '/workflows', { token: owner.token, ws: owner.ws });
  const row = (list.body || []).find((w) => String(w._id) === String(A));
  await sleep(400); // the stored flag trails the draft by a short debounce
  const list2 = await req('GET', '/workflows', { token: owner.token, ws: owner.ws });
  const row2 = (list2.body || []).find((w) => String(w._id) === String(A));
  check('dashboard list carries publishedVersion + hasUnpublishedChanges', row && row.publishedVersion === 1 && row2?.hasUnpublishedChanges === true, JSON.stringify(row2));

  const versions = await req('GET', `/workflows/${A}/versions`, { token: owner.token, ws: owner.ws });
  const v1 = versions.body?.[0];
  check('version list: number, message, publisher, live badge, node count', v1?.version === 1 && v1.message === 'first' && v1.isLive === true && v1.nodeCount === 3 && v1.publishedBy?.name === 'owner', JSON.stringify(v1));
  const vDoc = await db.collection('workflowversions').findOne({ workflowId: new mongoose.Types.ObjectId(A), version: 1 });
  check('v1 snapshot holds the published graph (1+1), not later edits', vDoc?.nodes?.find((n) => n.id === 'calc')?.data?.config?.params?.expression === '1+1', JSON.stringify(vDoc?.nodes?.find((n) => n.id === 'calc') || vDoc).slice(0, 200));
}

// ------------------------------------------------------------------ B
console.log('\nB. publish validation: errors → 422, warnings need acknowledgement');
{
  const empty = await makeWorkflow(owner, 'Empty');
  const r1 = await publish(owner, empty);
  check('empty workflow → 422 with errors', r1.status === 422 && r1.body?.errors?.some((e) => e.id === 'empty'), `${r1.status} ${JSON.stringify(r1.body)}`);
  const noStart = await makeWorkflow(owner, 'No start', { nodes: [N('e', 'end')], edges: [] });
  const r2 = await publish(owner, noStart);
  check('no Start node → 422 no-start', r2.status === 422 && r2.body?.errors?.some((e) => e.id === 'no-start'));
  const warn = await makeWorkflow(owner, 'Warns', { nodes: [N('s', 'start'), calc('2*2')], edges: [{ id: 'x', source: 's', target: 'calc' }] });
  const r3 = await publish(owner, warn);
  check('warnings without acknowledgeWarnings → 422', r3.status === 422 && r3.body?.needsAcknowledgement === true && r3.body?.warnings?.some((w) => w.id === 'no-end'), `${r3.status}`);
  const r4 = await publish(owner, warn, { acknowledgeWarnings: true });
  check('with acknowledgeWarnings → 201, warnings recorded on the version', r4.status === 201 && r4.body?.version?.warningsCount >= 1, `${r4.status} ${JSON.stringify(r4.body?.version)}`);
  const vp = await req('POST', `/workflows/${A}/publish`, { body: {}, token: viewer.token, ws: owner.ws });
  check('viewer cannot publish (403)', vp.status === 403);
}

// ------------------------------------------------------------------ C
console.log('\nC. automatic triggers run the PUBLISHED graph; the test run runs the draft');
const keyRes = await req('POST', `/workspaces/${owner.ws}/api-keys`, { body: { name: 'versions', scopes: ['events:publish', 'runs:create', 'runs:read'] }, token: owner.token });
const API_KEY = keyRes.body?.key;
{
  // Draft of A is '40+2'; v1 is '1+1'.
  const test = await req('POST', `/workflows/${A}/runs`, { body: {}, token: owner.token, ws: owner.ws });
  const tRun = await waitRun(owner, test.body?.runId);
  check('Builder Run (default) is a draft test run executing the draft (40+2)', tRun?.isDraft === true && calcOut(tRun) === '40+2' && tRun?.versionNumber === null, JSON.stringify({ d: tRun?.isDraft, out: calcOut(tRun), s: tRun?.status }));
  check('draft run records its graph snapshot', tRun?.graph?.nodes?.find((n) => n.id === 'calc')?.data?.config?.params?.expression === '40+2');

  const pub = await req('POST', `/workflows/${A}/runs`, { body: { source: 'published' }, token: owner.token, ws: owner.ws });
  const pRun = await waitRun(owner, pub.body?.runId);
  check('"Run published" executes v1 (1+1)', pRun?.isDraft === false && pRun?.versionNumber === 1 && calcOut(pRun) === '1+1', JSON.stringify({ v: pRun?.versionNumber, out: calcOut(pRun) }));

  const gen = await req('POST', `/workflows/${A}/webhook/regenerate`, { token: owner.token, ws: owner.ws });
  await req('PUT', `/workflows/${A}/webhook`, { body: { enabled: true }, token: owner.token, ws: owner.ws });
  const hook = await req('POST', `/hooks/${gen.body?.token}`, { body: { from: 'webhook' } });
  const hRun = await waitRun(owner, hook.body?.runId);
  check('webhook run executes the published graph', hook.status === 202 && hRun?.versionNumber === 1 && calcOut(hRun) === '1+1', `${hook.status} ${calcOut(hRun)}`);

  const evName = `ver.${uniq()}`;
  await req('PUT', `/workflows/${A}/event-trigger`, { body: { eventName: evName, enabled: true }, token: owner.token, ws: owner.ws });
  const ev = await req('POST', `/w/${owner.slug}/events/${evName}`, { body: {}, headers: { Authorization: `Bearer ${API_KEY}` } });
  const eRun = await waitRun(owner, ev.body?.triggered?.[0]);
  check('event run executes the published graph', ev.status === 202 && eRun?.versionNumber === 1 && calcOut(eRun) === '1+1', `${ev.status} ${JSON.stringify(ev.body)}`);

  const api = await req('POST', `/w/${owner.slug}/workflows/${A}/runs`, { body: {}, headers: { Authorization: `Bearer ${API_KEY}` } });
  const aRun = await waitRun(owner, api.body?.runId);
  check('API run executes the published graph', api.status === 202 && aRun?.versionNumber === 1 && calcOut(aRun) === '1+1', `${api.status} ${calcOut(aRun)}`);

  const since = Date.now();
  const sch = await req('PUT', `/workflows/${A}/schedule`, { body: { cronExpression: '* * * * * *', enabled: true }, token: owner.token, ws: owner.ws });
  if (!ok2xx(sch.status)) console.log('      schedule PUT', sch.status, JSON.stringify(sch.body));
  let sRun = null;
  for (let i = 0; i < 30 && !sRun; i++) {
    await sleep(200);
    const doc = await db.collection('runs').findOne({ workflowId: new mongoose.Types.ObjectId(A), trigger: 'schedule', createdAt: { $gte: new Date(since) } });
    if (doc) sRun = await waitRun(owner, String(doc._id));
  }
  await req('PUT', `/workflows/${A}/schedule`, { body: { cronExpression: '* * * * * *', enabled: false }, token: owner.token, ws: owner.ws });
  check('scheduled run executes the published graph', sRun?.versionNumber === 1 && calcOut(sRun) === '1+1', JSON.stringify({ v: sRun?.versionNumber, out: calcOut(sRun) }));
  await sleep(1200); // let any tick already in flight finish before later sections
}

// ------------------------------------------------------------------ D
console.log('\nD. a never-published workflow: automatic triggers skip, test runs work');
{
  const U = await makeWorkflow(owner, 'Never published', calcGraph('3+3'));
  const gen = await req('POST', `/workflows/${U}/webhook/regenerate`, { token: owner.token, ws: owner.ws });
  await req('PUT', `/workflows/${U}/webhook`, { body: { enabled: true }, token: owner.token, ws: owner.ws });
  const hook = await req('POST', `/hooks/${gen.body?.token}`, { body: {} });
  check('webhook → 409 "Workflow has no published version"', hook.status === 409 && /no published version/i.test(hook.body?.error || ''), `${hook.status} ${hook.body?.error}`);
  const api = await req('POST', `/w/${owner.slug}/workflows/${U}/runs`, { body: {}, headers: { Authorization: `Bearer ${API_KEY}` } });
  check('API → 409', api.status === 409, `${api.status}`);
  const evName = `ver.never.${uniq()}`;
  await req('PUT', `/workflows/${U}/event-trigger`, { body: { eventName: evName, enabled: true }, token: owner.token, ws: owner.ws });
  const ev = await req('POST', `/w/${owner.slug}/events/${evName}`, { body: {}, headers: { Authorization: `Bearer ${API_KEY}` } });
  check('event fan-out reports it in skipped with not-published', ev.status === 202 && ev.body?.triggered?.length === 0 && ev.body?.skipped?.some((s) => String(s.workflowId) === String(U) && s.reason === 'not-published'), JSON.stringify(ev.body));
  const pub = await req('POST', `/workflows/${U}/runs`, { body: { source: 'published' }, token: owner.token, ws: owner.ws });
  check('"Run published" → 409', pub.status === 409, `${pub.status}`);
  const since = Date.now();
  await req('PUT', `/workflows/${U}/schedule`, { body: { cronExpression: '* * * * * *', enabled: true }, token: owner.token, ws: owner.ws });
  await sleep(2300);
  await req('PUT', `/workflows/${U}/schedule`, { body: { cronExpression: '* * * * * *', enabled: false }, token: owner.token, ws: owner.ws });
  const sched = await db.collection('runs').countDocuments({ workflowId: new mongoose.Types.ObjectId(U), createdAt: { $gte: new Date(since) } });
  check('schedule ticks start no run', sched === 0, `${sched} run(s)`);
  const test = await req('POST', `/workflows/${U}/runs`, { body: {}, token: owner.token, ws: owner.ws });
  const tRun = await waitRun(owner, test.body?.runId);
  check('a test run of the draft still works', test.status === 202 && calcOut(tRun) === '3+3');
}

// ------------------------------------------------------------------ E
console.log('\nE. one active run per workflow PER KIND');
{
  const slow = { nodes: [N('s', 'start'), N('d', 'delay', { mode: 'duration', durationMs: 1500 }, 200), N('e', 'end', {}, 400)], edges: [{ id: 'a', source: 's', target: 'd' }, { id: 'b', source: 'd', target: 'e' }] };
  const S = await makeWorkflow(owner, 'Slow', slow);
  await publish(owner, S);
  const d1 = await req('POST', `/workflows/${S}/runs`, { body: { source: 'draft' }, token: owner.token, ws: owner.ws });
  const p1 = await req('POST', `/workflows/${S}/runs`, { body: { source: 'published' }, token: owner.token, ws: owner.ws });
  check('a test run and a published run can be active together', d1.status === 202 && p1.status === 202, `${d1.status} ${p1.status}`);
  const d2 = await req('POST', `/workflows/${S}/runs`, { body: { source: 'draft' }, token: owner.token, ws: owner.ws });
  const p2 = await req('POST', `/workflows/${S}/runs`, { body: { source: 'published' }, token: owner.token, ws: owner.ws });
  check('a second test run → 409', d2.status === 409, `${d2.status}`);
  check('a second published run → 409', p2.status === 409, `${p2.status}`);
  await waitRun(owner, d1.body?.runId);
  await waitRun(owner, p1.body?.runId);
}

// ------------------------------------------------------------------ F
console.log('\nF. a run renders ITS OWN graph after later publishes and edits');
let v1RunId;
{
  const r = await req('POST', `/workflows/${A}/runs`, { body: { source: 'published' }, token: owner.token, ws: owner.ws });
  v1RunId = r.body?.runId;
  await waitRun(owner, v1RunId);
  const p2 = await publish(owner, A, { message: 'second' }); // draft is 40+2
  check('publish v2 (40+2)', p2.status === 201 && p2.body?.version?.version === 2, `${p2.status}`);
  await req('PUT', `/workflows/${A}/`, { body: calcGraph('9*9'), token: owner.token, ws: owner.ws });
  const run = await req('GET', `/runs/${v1RunId}`, { token: owner.token, ws: owner.ws });
  const expr = run.body?.graph?.nodes?.find((n) => n.id === 'calc')?.data?.config?.params?.expression;
  check('GET /runs/:id returns the v1 graph, not v2 or the draft', expr === '1+1' && run.body?.versionNumber === 1, `expr=${expr}`);
  const hist = await req('GET', `/workflows/${A}/runs`, { token: owner.token, ws: owner.ws });
  check('run history rows carry isDraft / versionNumber', (hist.body || []).some((h) => h.isDraft === true) && (hist.body || []).some((h) => h.versionNumber === 1));
}

// ------------------------------------------------------------------ G
console.log('\nG. diff between versions and against the draft');
{
  const d = await req('GET', `/workflows/${A}/diff?from=1&to=2`, { token: owner.token, ws: owner.ws });
  const changed = d.body?.diff?.nodes?.changed?.find((c) => c.id === 'calc');
  check('v1 → v2: calc changed at params.expression', d.status === 200 && changed?.paths?.some((p) => p.join('.') === 'params.expression'), JSON.stringify(d.body?.diff));
  check('diff includes both graphs', d.body?.from?.nodes?.length === 3 && d.body?.to?.nodes?.length === 3);

  const g = calcGraph('9*9');
  g.nodes.push(N('extra', 'agent', {}, 600));
  g.nodes[0].position = { x: -50, y: 10 };
  g.edges = g.edges.filter((e) => e.id !== 'e2');
  g.edges.push({ id: 'e9', source: 'calc', target: 'e', label: 'new' });
  await req('PUT', `/workflows/${A}`, { body: { ...g, name: 'Versioned (renamed)' }, token: owner.token, ws: owner.ws });
  const dd = await req('GET', `/workflows/${A}/diff?from=2&to=draft`, { token: owner.token, ws: owner.ws });
  const x = dd.body?.diff;
  check('v2 → draft: added node, moved start, changed calc', x?.nodes?.added?.includes('extra') && x?.nodes?.moved?.includes('s') && !x?.nodes?.changed?.some((c) => c.id === 's') && x?.nodes?.changed?.some((c) => c.id === 'calc'), JSON.stringify(x?.nodes));
  check('v2 → draft: edge removed + added, name changed', x?.edges?.removed?.includes('e2') && x?.edges?.added?.includes('e9') && x?.nameChanged === true, JSON.stringify(x?.edges));
  const vd = await req('GET', `/workflows/${A}/diff?from=1&to=2`, { token: viewer.token, ws: owner.ws });
  const vl = await req('GET', `/workflows/${A}/versions`, { token: viewer.token, ws: owner.ws });
  const vv = await req('GET', `/workflows/${A}/versions/1`, { token: viewer.token, ws: owner.ws });
  check('viewer can list, view and diff versions', vd.status === 200 && vl.status === 200 && vv.status === 200 && vv.body?.nodes?.length === 3);
}

// ------------------------------------------------------------------ H
console.log('\nH. restore replaces the draft for collaborators, publishes nothing');
{
  const socket = io(socketUrl(), { auth: { token: owner.token }, transports: ['websocket'], forceNew: true, reconnection: false });
  const events = [];
  socket.onAny((event, payload) => events.push({ event, payload }));
  await new Promise((r) => socket.on('connect', r));
  const ack = await socket.timeout(3000).emitWithAck('workflow:subscribe', { workflowId: A }).catch((e) => ({ ok: false, error: e.message }));
  check('collaborator socket joined the workflow', ack?.ok === true, JSON.stringify(ack).slice(0, 120));
  await socket.timeout(3000).emitWithAck('workspace:subscribe', { workspaceId: owner.ws }).catch(() => null);

  const vr = await req('POST', `/workflows/${A}/versions/1/restore`, { token: viewer.token, ws: owner.ws });
  check('viewer cannot restore (403)', vr.status === 403);
  const before = (await getWf(owner, A)).body;
  const res = await req('POST', `/workflows/${A}/versions/1/restore`, { token: owner.token, ws: owner.ws });
  await sleep(400);
  const snap = events.find((e) => e.event === 'collab:snapshot' && e.payload?.reason === 'restored');
  check('restore → 200 { draftSeq }', res.status === 200 && Number.isInteger(res.body?.draftSeq), `${res.status} ${JSON.stringify(res.body)}`);
  check("collaborators get collab:snapshot { reason: 'restored', version: 1 }", snap?.payload?.version === 1 && snap.payload.nodes?.find((n) => n.id === 'calc')?.data?.config?.params?.expression === '1+1', JSON.stringify(snap?.payload || {}).slice(0, 160));
  const after = (await getWf(owner, A)).body;
  check('draft now holds v1 content; the live version is unchanged', after?.nodes?.find((n) => n.id === 'calc')?.data?.config?.params?.expression === '1+1' && after?.publishedVersion === before?.publishedVersion && before?.publishedVersion === 2);

  // Draft (1+1) differs from live v2 (40+2) → the flag turns on and is broadcast.
  const state = events.filter((e) => e.event === 'version:draft_state').pop();
  check('version:draft_state broadcast when the flag flips', state?.payload?.hasUnpublishedChanges === true, JSON.stringify(state?.payload));

  // ------------------------------------------------------------------ I
  console.log('\nI. roll back publishes an old version as a new one');
  const vrb = await req('POST', `/workflows/${A}/versions/1/rollback`, { token: viewer.token, ws: owner.ws });
  check('viewer cannot roll back (403)', vrb.status === 403);
  // Make the draft differ from v1 again so rollback leaves "unpublished changes" on.
  await req('PUT', `/workflows/${A}`, { body: calcGraph('5+5'), token: owner.token, ws: owner.ws });
  const rb = await req('POST', `/workflows/${A}/versions/1/rollback`, { body: { message: 'prod is broken' }, token: owner.token, ws: owner.ws });
  await sleep(300);
  check('rollback → 201 v3 with rolledBackFrom 1', rb.status === 201 && rb.body?.version?.version === 3 && rb.body?.version?.rolledBackFrom === 1, `${rb.status} ${JSON.stringify(rb.body)}`);
  check('version:published broadcast with rolledBackFrom', events.some((e) => e.event === 'version:published' && e.payload?.version === 3 && e.payload?.rolledBackFrom === 1));
  const wf = (await getWf(owner, A)).body;
  check('triggers switch immediately; the draft is untouched', wf?.publishedVersion === 3 && wf?.nodes?.find((n) => n.id === 'calc')?.data?.config?.params?.expression === '5+5' && wf?.hasUnpublishedChanges === true);
  const pr = await req('POST', `/workflows/${A}/runs`, { body: { source: 'published' }, token: owner.token, ws: owner.ws });
  const prRun = await waitRun(owner, pr.body?.runId);
  check('a published run now executes v3 = v1 content (1+1)', prRun?.versionNumber === 3 && calcOut(prRun) === '1+1', JSON.stringify({ v: prRun?.versionNumber, out: calcOut(prRun) }));
  socket.disconnect();
}

// ------------------------------------------------------------------ J
console.log('\nJ. share links show the published graph only');
{
  const sh = await req('POST', `/workflows/${A}/share`, { token: owner.token, ws: owner.ws });
  const shared = await req('GET', `/shared/${sh.body?.shareToken}`);
  const expr = shared.body?.workflow?.nodes?.find((n) => n.id === 'calc')?.data?.config?.params?.expression;
  check('shared view shows the live version (1+1), not the draft (5+5)', shared.status === 200 && expr === '1+1' && shared.body?.workflow?.version === 3, `${shared.status} ${expr}`);
  const U = await makeWorkflow(owner, 'Unshared draft', calcGraph('8+8'));
  const sh2 = await req('POST', `/workflows/${U}/share`, { token: owner.token, ws: owner.ws });
  const s2 = await req('GET', `/shared/${sh2.body?.shareToken}`);
  check('never-published workflow: shared page says so (404 notPublished)', s2.status === 404 && s2.body?.notPublished === true && !s2.body?.workflow, `${s2.status} ${JSON.stringify(s2.body)}`);
}

// ------------------------------------------------------------------ K
console.log('\nK. sub-workflow and loop children run their PUBLISHED version');
{
  const child = await makeWorkflow(owner, 'Child', calcGraph('7*6'));
  await publish(owner, child);
  await req('PUT', `/workflows/${child}`, { body: calcGraph('1-1'), token: owner.token, ws: owner.ws });
  const parentGraph = (type, extra = {}) => ({
    nodes: [N('s', 'start'), N('c', type, { workflowId: child, ...extra }, 200), N('e', 'end', {}, 400)],
    edges: [{ id: 'a', source: 's', target: 'c' }, { id: 'b', source: 'c', target: 'e' }],
  });
  const P = await makeWorkflow(owner, 'Parent', parentGraph('subworkflow'));
  const r = await req('POST', `/workflows/${P}/runs`, { body: {}, token: owner.token, ws: owner.ws });
  const run = await waitRun(owner, r.body?.runId);
  const childRunId = run?.nodeResults?.find((n) => n.nodeId === 'c')?.childRunIds?.[0];
  const childRun = childRunId && await waitRun(owner, String(childRunId));
  check('sub-workflow child ran the child\'s v1 (7*6), not its draft (1-1)', run?.status === 'success' && childRun?.versionNumber === 1 && calcOut(childRun) === '7*6', JSON.stringify({ s: run?.status, v: childRun?.versionNumber, out: calcOut(childRun) }));

  const L = await makeWorkflow(owner, 'Looper', parentGraph('loop', { itemsPath: '{{input.items}}', concurrency: 2 }));
  const lr = await req('POST', `/workflows/${L}/runs`, { body: {}, token: owner.token, ws: owner.ws });
  // A test run has no input; the loop's items come from the Start node's output.
  const lrun = await waitRun(owner, lr.body?.runId);
  const loopChildren = lrun?.nodeResults?.find((n) => n.nodeId === 'c')?.childRunIds || [];
  if (loopChildren.length) {
    const first = await waitRun(owner, String(loopChildren[0]));
    check('loop body children run the body\'s published version', first?.versionNumber === 1 && calcOut(first) === '7*6', JSON.stringify({ v: first?.versionNumber, out: calcOut(first) }));
  } else {
    // No items → no children; run it through the API with items instead (published parent).
    await publish(owner, L, { acknowledgeWarnings: true });
    const ar = await req('POST', `/w/${owner.slug}/workflows/${L}/runs`, { body: { items: [1, 2] }, headers: { Authorization: `Bearer ${API_KEY}` } });
    const arun = await waitRun(owner, ar.body?.runId);
    const kids = arun?.nodeResults?.find((n) => n.nodeId === 'c')?.childRunIds || [];
    const first = kids.length ? await waitRun(owner, String(kids[0])) : null;
    check('loop body children run the body\'s published version', kids.length === 2 && first?.versionNumber === 1 && calcOut(first) === '7*6', JSON.stringify({ n: kids.length, v: first?.versionNumber, out: calcOut(first), s: arun?.status }));
  }

  const orphan = await makeWorkflow(owner, 'Unpublished child', calcGraph('2+2'));
  const P2 = await makeWorkflow(owner, 'Parent of unpublished', { ...parentGraph('subworkflow'), nodes: parentGraph('subworkflow').nodes.map((n) => (n.id === 'c' ? N('c', 'subworkflow', { workflowId: orphan }, 200) : n)) });
  const r2 = await req('POST', `/workflows/${P2}/runs`, { body: {}, token: owner.token, ws: owner.ws });
  const run2 = await waitRun(owner, r2.body?.runId);
  const logs = (run2?.nodeResults?.find((n) => n.nodeId === 'c')?.logs || []).join(' ');
  check('an unpublished child fails the node with "has no published version"', run2?.status === 'failed' && /no published version/.test(logs), `${run2?.status} ${logs.slice(0, 140)}`);
}

// ------------------------------------------------------------------ L
console.log('\nL. boot migration publishes v1 once');
{
  const { migrateVersions } = await import('./migrateVersions.js');
  const migrateUri = `${DB_URI.replace(/\/+$/, '')}-versionsmigrate`;
  const conn = mongoose.connection;
  await mongoose.disconnect();
  await mongoose.connect(migrateUri);
  await mongoose.connection.db.dropDatabase();
  const wfs = mongoose.connection.db.collection('workflows');
  const ws = new mongoose.Types.ObjectId();
  const creator = new mongoose.Types.ObjectId();
  const full = await wfs.insertOne({ workspaceId: ws, createdBy: creator, name: 'Phase 2', nodes: calcGraph('1+1').nodes, edges: calcGraph('1+1').edges, draftSeq: 4 });
  await wfs.insertOne({ workspaceId: ws, name: 'Empty', nodes: [], edges: [] });
  const quiet = () => {};
  const first = await migrateVersions({ log: quiet });
  const second = await migrateVersions({ log: quiet });
  const migrated = await wfs.findOne({ _id: full.insertedId });
  const v1 = await mongoose.connection.db.collection('workflowversions').findOne({ workflowId: full.insertedId });
  check('first run publishes the non-empty workflow only', first.published === 1, JSON.stringify(first));
  check('second run is a no-op', second.published === 0, JSON.stringify(second));
  check('v1: message, publishedBy = createdBy, pointer fields set', v1?.version === 1 && v1.message === 'Initial version (migrated)' && String(v1.publishedBy) === String(creator) && String(migrated?.publishedVersionId) === String(v1?._id) && migrated?.publishedVersion === 1 && migrated?.hasUnpublishedChanges === false);
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  await mongoose.connect(DB_URI);
  void conn;
}

// ------------------------------------------------------------------ M
console.log('\nM. shared validation fixtures (server copy; check:logic runs the client copy)');
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const { cases } = JSON.parse(fs.readFileSync(path.join(here, '..', 'engine', 'validationFixtures.json'), 'utf8'));
  const ids = (list) => list.map((x) => x.id).sort();
  for (const c of cases) {
    const r = validateGraph(c.input);
    const got = { errors: ids(r.errors), warnings: ids(r.warnings), info: ids(r.info) };
    const ok = ['errors', 'warnings', 'info'].every((k) => JSON.stringify(got[k]) === JSON.stringify([...c.expect[k]].sort()));
    check(`fixture: ${c.name}`, ok, ok ? '' : JSON.stringify(got));
  }
}

await mongoose.disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
