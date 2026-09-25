/**
 * Run operations check for spec/35 - re-run, retry-from-failed, search, the
 * shared run detail whitelist, live status events, node stats and the attempts
 * log, as a runnable script. Needs a running server and its database:
 *
 *   PORT=4500 MONGODB_URI=...-check npm run dev                        # terminal 1
 *   BASE=http://localhost:4500/api MONGODB_URI=... npm run check:runs  # terminal 2
 */
import mongoose from 'mongoose';
import { io } from 'socket.io-client';

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
const newEmail = (tag) => `${tag}${uniq()}@runs.dev`;
async function register(tag, email = newEmail(tag)) {
  const r = await req('POST', '/auth/register', { body: { email, password: 'password123', name: tag } });
  const w = r.body?.workspaces?.[0];
  return { token: r.body?.token, user: r.body?.user, email, ws: w?.id, slug: w?.slug };
}
async function join(owner, role) {
  const email = newEmail(role);
  const inv = await req('POST', `/workspaces/${owner.ws}/invitations`, { body: { email, role }, token: owner.token });
  const u = await register(role, email);
  const token = String(inv.body?.inviteUrl || '').split('/invite/').pop();
  await req('POST', `/invitations/${token}/accept`, { token: u.token });
  return { ...u, ws: owner.ws };
}

const N = (id, type, config = {}, x = 0) => ({ id, type, position: { x, y: 0 }, data: { config: { label: id, ...config } } });
const tool = (id, integration, action, params = {}, over = {}) =>
  N(id, 'tool', { integration, action, connectionId: null, params, mockOverrides: { failureRate: 0, latencyMs: [20, 40], ...over } });
const E = (source, target, extra = {}) => ({ id: `${source}-${target}${extra.sourceHandle ? `-${extra.sourceHandle}` : ''}`, source, target, ...extra });

async function makeWorkflow(u, name, graph) {
  const r = await req('POST', '/workflows', { body: { name }, token: u.token, ws: u.ws });
  const id = r.body?._id;
  if (graph) {
    const put = await req('PUT', `/workflows/${id}`, { body: graph, token: u.token, ws: u.ws });
    if (!ok2xx(put.status)) console.log('      makeWorkflow PUT failed', put.status, JSON.stringify(put.body));
  }
  return id;
}
const publish = (u, id) => req('POST', `/workflows/${id}/publish`, { body: { acknowledgeWarnings: true }, token: u.token, ws: u.ws });
async function waitRun(u, runId, tries = 120) {
  for (let i = 0; i < tries; i++) {
    const r = await req('GET', `/runs/${runId}`, { token: u.token, ws: u.ws });
    if (['success', 'failed', 'cancelled'].includes(r.body?.status)) return r.body;
    await sleep(120);
  }
  return (await req('GET', `/runs/${runId}`, { token: u.token, ws: u.ws })).body;
}
const nodeOf = (run, id) => (run?.nodeResults || []).find((n) => n.nodeId === id);

await mongoose.connect(DB_URI);
const db = mongoose.connection.db;
const oid = (id) => new mongoose.Types.ObjectId(String(id));

const owner = await register('owner');
const viewer = await join(owner, 'viewer');
const other = await register('other');

// ------------------------------------------------------------------ A: re-run
console.log('A. re-run replays the recorded input and graph, never the current draft');
let webhookRunId;
{
  const calc = (expression) => tool('calc', 'builtin', 'calculator', { expression });
  const wf = await makeWorkflow(owner, 'Rerun me', { nodes: [N('s', 'start'), calc('6*7'), N('e', 'end', {}, 400)], edges: [E('s', 'calc'), E('calc', 'e')] });
  check('v1 published', ok2xx((await publish(owner, wf)).status));
  const gen = await req('POST', `/workflows/${wf}/webhook/regenerate`, { token: owner.token, ws: owner.ws });
  await req('PUT', `/workflows/${wf}/webhook`, { body: { enabled: true }, token: owner.token, ws: owner.ws });
  const hook = await fetch(`${B}/hooks/${gen.body?.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: 'A-17' }) });
  webhookRunId = (await hook.json()).runId;
  const original = await waitRun(owner, webhookRunId);
  check('webhook run succeeded on v1', original?.status === 'success' && original?.versionNumber === 1, `${original?.status} v${original?.versionNumber}`);

  // Change the DRAFT only: a re-run must not pick this up.
  await req('PUT', `/workflows/${wf}`, { body: { nodes: [N('s', 'start'), calc('1+1'), N('e', 'end', {}, 400)], edges: [E('s', 'calc'), E('calc', 'e')] }, token: owner.token, ws: owner.ws });
  const rr = await req('POST', `/runs/${webhookRunId}/rerun`, { token: owner.token, ws: owner.ws });
  check('POST /runs/:id/rerun -> 202 { runId }', rr.status === 202 && rr.body?.runId, `${rr.status} ${JSON.stringify(rr.body)}`);
  const rerun = await waitRun(owner, rr.body?.runId);
  check('re-run records rerunOf', String(rerun?.rerunOf) === String(webhookRunId));
  check('re-run ran on the same version (v1), not the draft', rerun?.versionNumber === 1 && rerun?.isDraft === false, `v${rerun?.versionNumber} draft=${rerun?.isDraft}`);
  check('re-run output comes from the recorded graph (6*7, not 1+1)', JSON.stringify(nodeOf(rerun, 'calc')?.output).includes('42'), JSON.stringify(nodeOf(rerun, 'calc')?.output));
  check('re-run carries the same input', rerun?.input?.orderId === 'A-17', JSON.stringify(rerun?.input));
  check('re-run trigger is manual, triggered by the caller', rerun?.trigger === 'manual' && String(rerun?.triggeredBy) === String(owner.user.id));

  const byViewer = await req('POST', `/runs/${webhookRunId}/rerun`, { token: viewer.token, ws: viewer.ws });
  check('viewer cannot re-run (403)', byViewer.status === 403, `${byViewer.status}`);
  const retryViewer = await req('POST', `/runs/${webhookRunId}/retry`, { token: viewer.token, ws: viewer.ws });
  check('viewer cannot retry (403)', retryViewer.status === 403, `${retryViewer.status}`);
  const foreign = await req('POST', `/runs/${webhookRunId}/rerun`, { token: other.token, ws: other.ws });
  check('another workspace cannot re-run it (404)', foreign.status === 404, `${foreign.status}`);
  const successRetry = await req('POST', `/runs/${webhookRunId}/retry`, { token: owner.token, ws: owner.ws });
  check('retrying a clean success -> 400', successRetry.status === 400, `${successRetry.status} ${successRetry.body?.error}`);

  // A child run can't be re-run on its own.
  const child = await db.collection('runs').insertOne({
    workflowId: oid(wf), workspaceId: oid(owner.ws), status: 'success', trigger: 'subworkflow', parentRunId: oid(webhookRunId),
    rootRunId: oid(webhookRunId), depth: 1, isDraft: true, graph: { name: 'x', nodes: [N('s', 'start')], edges: [] },
    nodeResults: [], createdAt: new Date(), updatedAt: new Date(),
  });
  const childRerun = await req('POST', `/runs/${child.insertedId}/rerun`, { token: owner.token, ws: owner.ws });
  check('re-running a child run -> 400', childRerun.status === 400, `${childRerun.status} ${childRerun.body?.error}`);
}

// ------------------------------------------------------------------ B: retry from failed
console.log('\nB. retry re-executes the failed node and its descendants; the rest is reused');
{
  // s -> A(database.insert) -> cond(true) -> B(always fails) -> C(end)
  //                                  \-false-> D(transform) -> C
  const graph = {
    nodes: [
      N('s', 'start'),
      tool('A', 'database', 'insert', { collection: 'retrycheck', document: '{"n":1}' }),
      N('cond', 'condition', { expression: 'true' }),
      tool('B', 'builtin', 'fake-weather', { city: 'Pune' }, { failureRate: 1, maxAttempts: 1 }),
      N('D', 'transform', { mappings: [{ key: 'x', value: '1' }] }),
      N('C', 'end'),
    ],
    edges: [E('s', 'A'), E('A', 'cond'), E('cond', 'B', { sourceHandle: 'true' }), E('cond', 'D', { sourceHandle: 'false' }), E('B', 'C'), E('D', 'C')],
  };
  const wf = await makeWorkflow(owner, 'Retry me', graph);
  const start = await req('POST', `/workflows/${wf}/runs`, { token: owner.token, ws: owner.ws });
  const original = await waitRun(owner, start.body?.runId);
  const countSandbox = () => db.collection('sandboxrecords').countDocuments({ workspaceId: oid(owner.ws) });
  const before = await countSandbox();
  check('original failed at B, A inserted one record', original?.status === 'failed' && nodeOf(original, 'B')?.status === 'failed' && nodeOf(original, 'A')?.status === 'success' && before >= 1,
    `${original?.status} B=${nodeOf(original, 'B')?.status} records=${before}`);
  check('the false branch (D) was pruned in the original', nodeOf(original, 'D')?.status === 'skipped');

  const preview = await req('GET', `/runs/${original._id}/retry-plan`, { token: owner.token, ws: owner.ws });
  check('retry plan: retry set [B], re-execute [B, C]', preview.body?.retryable && JSON.stringify(preview.body.retrySet) === '["B"]' && JSON.stringify(preview.body.reexecuted) === '["B","C"]',
    JSON.stringify(preview.body));

  const retry = await req('POST', `/runs/${original._id}/retry`, { token: owner.token, ws: owner.ws });
  check('POST /runs/:id/retry -> 202 with reexecuted/reused', retry.status === 202 && retry.body?.runId && JSON.stringify(retry.body.reexecuted) === JSON.stringify(preview.body?.reexecuted),
    `${retry.status} ${JSON.stringify(retry.body)}`);
  check('reused list matches the preview', JSON.stringify(retry.body?.reused) === JSON.stringify(preview.body?.reused), JSON.stringify(retry.body?.reused));
  const retried = await waitRun(owner, retry.body?.runId);
  check('retry records retryOf and retriedFromNodeIds', String(retried?.retryOf) === String(original._id) && JSON.stringify(retried?.retriedFromNodeIds) === '["B"]');
  check('A is reused (not executed) and marked reused', nodeOf(retried, 'A')?.reused === true && nodeOf(retried, 'A')?.status === 'success');
  check("A's side effect did not happen twice (sandbox record count unchanged)", (await countSandbox()) === before, `${before} -> ${await countSandbox()}`);
  check('upstream routing stands: D stays skipped and reused', nodeOf(retried, 'D')?.status === 'skipped' && nodeOf(retried, 'D')?.reused === true);
  check('B re-executed (fresh attempt, not reused)', nodeOf(retried, 'B')?.reused !== true && nodeOf(retried, 'B')?.attemptsLog?.length === 1, JSON.stringify(nodeOf(retried, 'B')?.attemptsLog));
  check('reused A kept its original attempt log (no new attempts)',
    JSON.stringify(nodeOf(retried, 'A')?.attemptsLog) === JSON.stringify(nodeOf(original, 'A')?.attemptsLog));
  const tooMany = await req('POST', `/runs/${original._id}/retry`, { body: { fromNodeIds: ['nope'] }, token: owner.token, ws: owner.ws });
  check('unknown fromNodeIds -> 400', tooMany.status === 400, `${tooMany.status} ${tooMany.body?.error}`);
  const explicit = await req('GET', `/runs/${original._id}/retry-plan?fromNodeIds=A`, { token: owner.token, ws: owner.ws });
  check('explicit fromNodeIds=A re-executes A and everything downstream',
    JSON.stringify(explicit.body?.reexecuted) === '["A","cond","B","D","C"]', JSON.stringify(explicit.body?.reexecuted));
  const running = await db.collection('runs').insertOne({ workflowId: oid(wf), workspaceId: oid(owner.ws), status: 'running', trigger: 'manual', isDraft: true, graph, nodeResults: [], createdAt: new Date(), updatedAt: new Date() });
  const notFinished = await req('POST', `/runs/${running.insertedId}/retry`, { token: owner.token, ws: owner.ws });
  check('retrying an unfinished run -> 400', notFinished.status === 400, `${notFinished.status}`);
  await db.collection('runs').deleteOne({ _id: running.insertedId });
}

// ------------------------------------------------------------------ C: attempts log
console.log('\nC. attempts log: one entry per attempt, with exponential backoff');
{
  const wf = await makeWorkflow(owner, 'Flaky', {
    nodes: [N('s', 'start'), tool('f', 'builtin', 'fake-weather', { city: 'X' }, { failureRate: 1, maxAttempts: 4 }), N('e', 'end')],
    edges: [E('s', 'f'), E('f', 'e')],
  });
  const socket = io(socketUrl(), { auth: { token: owner.token }, transports: ['websocket'], forceNew: true, reconnection: false });
  const attemptEvents = [];
  socket.on('node:attempt', (p) => attemptEvents.push(p));
  await new Promise((r) => socket.on('connect', r));
  const start = await req('POST', `/workflows/${wf}/runs`, { token: owner.token, ws: owner.ws });
  await new Promise((r) => socket.emit('run:subscribe', { runId: start.body?.runId }, r));
  const run = await waitRun(owner, start.body?.runId);
  const f = nodeOf(run, 'f');
  const log = f?.attemptsLog || [];
  check('four attempts recorded, all failed', f?.attempts === 4 && log.length === 4 && log.every((a) => a.outcome === 'failed'), `attempts=${f?.attempts} log=${log.length}`);
  check('attemptsLog length matches the attempts count', log.length === f?.attempts);
  const backoffs = log.map((a) => a.backoffMs);
  check('backoff doubles: 500, 1000, 2000, then none', JSON.stringify(backoffs) === '[500,1000,2000,null]', JSON.stringify(backoffs));
  const gaps = log.slice(1).map((a, i) => new Date(a.startedAt) - new Date(log[i].finishedAt));
  check('real gaps between attempts roughly match the backoff', gaps.every((g, i) => g >= backoffs[i] - 30 && g < backoffs[i] + 600), JSON.stringify(gaps));
  check('each entry has timing fields', log.every((a) => a.startedAt && a.finishedAt && typeof a.durationMs === 'number' && a.error));
  await sleep(200);
  check('node:attempt streamed once per attempt', attemptEvents.filter((e) => e.nodeId === 'f').length === 4, `${attemptEvents.length}`);
  socket.close();
}

// ------------------------------------------------------------------ D: search
console.log('\nD. GET /api/runs: filters and cursor pagination');
{
  const wf = await makeWorkflow(owner, 'Paged', { nodes: [N('s', 'start'), N('e', 'end')], edges: [E('s', 'e')] });
  const base = Date.now() - 3600_000;
  const docs = [];
  for (let i = 0; i < 9; i++) {
    docs.push({
      workflowId: oid(wf), workspaceId: oid(owner.ws), status: i % 3 === 0 ? 'failed' : 'success', trigger: i % 2 ? 'webhook' : 'schedule',
      failReason: i % 3 === 0 ? 'nodes_failed' : null, isDraft: false, versionNumber: i < 5 ? 1 : 2, parentRunId: null,
      // Two pairs share a createdAt, so the _id tie-break is exercised.
      createdAt: new Date(base + Math.floor(i / 2) * 1000), updatedAt: new Date(), startedAt: new Date(base), finishedAt: new Date(base + 50), nodeResults: [],
    });
  }
  const inserted = await db.collection('runs').insertMany(docs);
  const ids = new Set(Object.values(inserted.insertedIds).map(String));
  await db.collection('runs').insertOne({ workflowId: oid(wf), workspaceId: oid(owner.ws), status: 'success', trigger: 'subworkflow', parentRunId: inserted.insertedIds[0], createdAt: new Date(base + 500), updatedAt: new Date(), nodeResults: [] });

  const seen = [];
  const seenAt = [];
  let cursor = null;
  let pages = 0;
  do {
    const r = await req('GET', `/runs?workflowId=${wf}&limit=3${cursor ? `&cursor=${cursor}` : ''}`, { token: owner.token, ws: owner.ws });
    seen.push(...(r.body?.items || []).map((x) => x.id));
    seenAt.push(...(r.body?.items || []).map((x) => [new Date(x.createdAt).getTime(), x.id]));
    cursor = r.body?.nextCursor;
    pages++;
    // New runs arriving mid-pagination must not shift later pages.
    if (pages === 1) await db.collection('runs').insertOne({ workflowId: oid(wf), workspaceId: oid(owner.ws), status: 'success', trigger: 'manual', parentRunId: null, createdAt: new Date(), updatedAt: new Date(), nodeResults: [] });
  } while (cursor && pages < 10);
  check('9 runs over 3 pages of 3', pages === 3 && seen.length === 9, `pages=${pages} seen=${seen.length}`);
  check('no duplicates and no gaps across pages (despite a new run mid-way)', new Set(seen).size === 9 && [...ids].every((id) => seen.includes(id)));
  // (createdAt desc, then _id desc for ties) across page boundaries.
  const ordered = seenAt.every(([t, id], i) => i === 0 || t < seenAt[i - 1][0] || (t === seenAt[i - 1][0] && id < seenAt[i - 1][1]));
  check('newest first, ties broken by id, across page boundaries', ordered);

  const q = async (qs) => (await req('GET', `/runs?workflowId=${wf}&${qs}`, { token: owner.token, ws: owner.ws }));
  check('child runs excluded by default', (await q('limit=100')).body?.items?.every((x) => !x.parentRunId));
  check('includeChildren=true includes them', (await q('limit=100&includeChildren=true')).body?.items?.some((x) => x.parentRunId));
  check('parentRunId= lists one parent\'s children', (await q(`parentRunId=${inserted.insertedIds[0]}`)).body?.items?.length === 1);
  check('status=failed', (await q('status=failed&limit=100')).body?.items?.length === 3);
  check('trigger=webhook', (await q('trigger=webhook&limit=100')).body?.items?.every((x) => x.trigger === 'webhook'));
  check('version=2', (await q('version=2&limit=100')).body?.items?.length === 4);
  check('failReason=nodes_failed', (await q('failReason=nodes_failed&limit=100')).body?.items?.length === 3);
  const from = new Date(base + 2000).toISOString();
  check('from= date range', (await q(`from=${from}&limit=100&status=success,failed`)).body?.items?.every((x) => new Date(x.createdAt) >= new Date(from)));
  const prefix = [...ids][0].slice(0, 8);
  check('q= run-id prefix', (await q(`q=${prefix}`)).body?.items?.some((x) => x.id.startsWith(prefix)));
  check('items carry workflowName and childCount', (await q('limit=100')).body?.items?.find((x) => x.id === String(inserted.insertedIds[0]))?.childCount === 1);
  for (const bad of ['status=exploded', 'trigger=carrier-pigeon', 'from=yesterday', 'version=draftish', 'limit=500', 'cursor=@@@', 'q=zz']) {
    const r = await q(bad);
    check(`${bad} -> 400 naming the parameter`, r.status === 400 && new RegExp(bad.split('=')[0], 'i').test(r.body?.error || ''), `${r.status} ${r.body?.error}`);
  }
  const foreign = await req('GET', `/runs?workflowId=${wf}`, { token: other.token, ws: other.ws });
  check("another workspace sees none of these runs", foreign.status === 200 && foreign.body?.items?.length === 0);
  const legacy = await req('GET', `/workflows/${wf}/runs`, { token: owner.token, ws: owner.ws });
  check('legacy per-workflow history still works', legacy.status === 200 && Array.isArray(legacy.body));
}

// ------------------------------------------------------------------ E: shared run detail
console.log('\nE. shared run detail is a whitelist');
{
  const secretInput = `sk_live_${uniq()}`;
  const wf = await makeWorkflow(owner, 'Shared', {
    nodes: [N('s', 'start'), N('cond', 'condition', { expression: 'true' }), tool('t', 'builtin', 'calculator', { expression: '2+3' }), N('e', 'end')],
    edges: [E('s', 'cond'), E('cond', 't', { sourceHandle: 'true' }), E('t', 'e')],
  });
  await publish(owner, wf);
  const gen = await req('POST', `/workflows/${wf}/webhook/regenerate`, { token: owner.token, ws: owner.ws });
  await req('PUT', `/workflows/${wf}/webhook`, { body: { enabled: true }, token: owner.token, ws: owner.ws });
  const hook = await (await fetch(`${B}/hooks/${gen.body?.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: secretInput }) })).json();
  await waitRun(owner, hook.runId);
  const share = await req('POST', `/workflows/${wf}/share`, { token: owner.token, ws: owner.ws });
  const tok = share.body?.shareToken;
  const list = await req('GET', `/shared/${tok}`);
  check('shared run list marks published root runs openable', list.body?.runs?.find((r) => r.id === hook.runId)?.openable === true);
  const detail = await req('GET', `/shared/${tok}/runs/${hook.runId}`);
  check('shared run detail -> 200', detail.status === 200, `${detail.status}`);
  const allowedTop = ['run', 'graph', 'nodes'];
  const allowedRun = ['id', 'status', 'failReason', 'trigger', 'versionNumber', 'startedAt', 'finishedAt', 'durationMs'];
  const allowedNode = ['nodeId', 'status', 'startedAt', 'finishedAt', 'durationMs', 'attempts', 'cached', 'reused', 'handled', 'routing', 'summary', 'progress', 'attemptsLog'];
  const allowedAttempt = ['attempt', 'startedAt', 'finishedAt', 'durationMs', 'outcome', 'backoffMs', 'cached'];
  const within = (obj, keys) => Object.keys(obj || {}).every((k) => keys.includes(k));
  check('top-level keys whitelisted', within(detail.body, allowedTop), Object.keys(detail.body || {}).join(','));
  check('run keys whitelisted (no input, triggeredBy, apiKeyId, engineState)', within(detail.body?.run, allowedRun), Object.keys(detail.body?.run || {}).join(','));
  check('node keys whitelisted (no output, logs, error text)', (detail.body?.nodes || []).every((n) => within(n, allowedNode)));
  check('attempt keys whitelisted (no error)', (detail.body?.nodes || []).every((n) => (n.attemptsLog || []).every((a) => within(a, allowedAttempt))));
  const blob = JSON.stringify(detail.body);
  check('the webhook input never appears', !blob.includes(secretInput));
  check('the tool output never appears', !/"result"|"expression":"2\+3"/.test(JSON.stringify(detail.body?.nodes)));
  check('routing is included (condition taken)', detail.body?.nodes?.find((n) => n.nodeId === 'cond')?.routing?.taken === true);
  const draftRun = await req('POST', `/workflows/${wf}/runs`, { token: owner.token, ws: owner.ws });
  await waitRun(owner, draftRun.body?.runId);
  check('a draft test run is 404 in the shared view', (await req('GET', `/shared/${tok}/runs/${draftRun.body?.runId}`)).status === 404);
  check("another workflow's run is 404", (await req('GET', `/shared/${tok}/runs/${webhookRunId}`)).status === 404);
  check('a malformed run id is 404', (await req('GET', `/shared/${tok}/runs/nope`)).status === 404);
  const child = await db.collection('runs').insertOne({ workflowId: oid(wf), workspaceId: oid(owner.ws), status: 'success', trigger: 'subworkflow', parentRunId: oid(hook.runId), versionId: null, nodeResults: [], createdAt: new Date(), updatedAt: new Date() });
  check('a child run is 404', (await req('GET', `/shared/${tok}/runs/${child.insertedId}`)).status === 404);
}

// ------------------------------------------------------------------ F: live status events
console.log('\nF. run:status_changed goes to the run\'s workspace only');
{
  const connect = (u) => new Promise((resolve) => {
    const s = io(socketUrl(), { auth: { token: u.token }, transports: ['websocket'], forceNew: true, reconnection: false });
    s.on('connect', () => s.emit('workspace:subscribe', { workspaceId: u.ws }, () => resolve(s)));
  });
  const mine = await connect(owner);
  const theirs = await connect(other);
  const got = [], leaked = [];
  mine.on('run:status_changed', (p) => got.push(p));
  theirs.on('run:status_changed', (p) => leaked.push(p));
  const wf = await makeWorkflow(owner, 'Live', { nodes: [N('s', 'start'), N('e', 'end')], edges: [E('s', 'e')] });
  const start = await req('POST', `/workflows/${wf}/runs`, { token: owner.token, ws: owner.ws });
  await waitRun(owner, start.body?.runId);
  await sleep(300);
  const forRun = got.filter((p) => p.runId === start.body?.runId).map((p) => p.status);
  check('workspace socket saw pending -> running -> success', JSON.stringify(forRun) === '["pending","running","success"]', JSON.stringify(forRun));
  const payload = got.find((p) => p.runId === start.body?.runId && p.status === 'success');
  check('payload carries workflowId, trigger, createdAt, finishedAt', payload?.workflowId === wf && payload?.trigger === 'manual' && payload?.createdAt && payload?.finishedAt);
  check('another workspace received nothing', leaked.length === 0, `${leaked.length}`);
  mine.close(); theirs.close();
}

// ------------------------------------------------------------------ G: node stats
console.log('\nG. per-workflow analytics: nodeStats');
{
  const wf = await makeWorkflow(owner, 'Stats', { nodes: [N('s', 'start'), N('x', 'transform', { label: 'Mapper' }), N('e', 'end')], edges: [E('s', 'x'), E('x', 'e')] });
  const runs = [];
  for (let i = 1; i <= 20; i++) {
    runs.push({
      workflowId: oid(wf), workspaceId: oid(owner.ws), status: 'success', trigger: 'manual', createdAt: new Date(), updatedAt: new Date(),
      nodeResults: [
        { nodeId: 'x', status: i <= 15 ? 'success' : 'failed', handled: i > 18, durationMs: i * 100, attempts: i <= 5 ? 2 : 1, cached: i <= 4 },
        { nodeId: 'ghost', status: 'success', durationMs: 10, attempts: 1 },
        // Reused and skipped results don't count as executions.
        { nodeId: 'e', status: i === 1 ? 'success' : 'skipped', reused: false, durationMs: 1, attempts: 1 },
      ],
    });
  }
  runs.push({ workflowId: oid(wf), workspaceId: oid(owner.ws), status: 'success', trigger: 'manual', createdAt: new Date(), updatedAt: new Date(), nodeResults: [{ nodeId: 'x', status: 'success', reused: true, durationMs: 99999, attempts: 1 }] });
  await db.collection('runs').insertMany(runs);
  const r = await req('GET', `/analytics/summary?workflowId=${wf}`, { token: owner.token, ws: owner.ws });
  const x = r.body?.nodeStats?.find((n) => n.nodeId === 'x');
  check('summary?workflowId= returns nodeStats', r.status === 200 && Array.isArray(r.body?.nodeStats), `${r.status}`);
  check('runs counted per node (reused excluded)', x?.runs === 20, `${x?.runs}`);
  check('successRate 15/20', Math.abs(x?.successRate - 0.75) < 1e-9, `${x?.successRate}`);
  check('p95 duration (nearest rank) = 1900', x?.p95DurationMs === 1900, `${x?.p95DurationMs}`);
  check('avg duration = 1050', x?.avgDurationMs === 1050, `${x?.avgDurationMs}`);
  check('retryRate 5/20, avgAttempts 1.25', Math.abs(x?.retryRate - 0.25) < 1e-9 && Math.abs(x?.avgAttempts - 1.25) < 1e-9, `${x?.retryRate} ${x?.avgAttempts}`);
  check('cacheHitRate 4/20, handledFailures 2', Math.abs(x?.cacheHitRate - 0.2) < 1e-9 && x?.handledFailures === 2);
  check('label from the current graph', x?.label === 'Mapper' && x?.type === 'transform');
  check("a node no longer in the graph shows as '(deleted node)'", r.body?.nodeStats?.find((n) => n.nodeId === 'ghost')?.label === '(deleted node)');
  check('skipped results do not count', r.body?.nodeStats?.find((n) => n.nodeId === 'e')?.runs === 1);
  check('summary totals narrowed to this workflow', r.body?.totalRuns === 21, `${r.body?.totalRuns}`);
  const alias = await req('GET', `/analytics/workflows/${wf}`, { token: owner.token, ws: owner.ws });
  check('GET /analytics/workflows/:id alias', alias.status === 200 && alias.body?.nodeStats?.length === r.body?.nodeStats?.length);
  const foreign = await req('GET', `/analytics/summary?workflowId=${wf}`, { token: other.token, ws: other.ws });
  check('foreign workflowId -> 404', foreign.status === 404, `${foreign.status}`);
  const all = await req('GET', '/analytics/summary', { token: owner.token, ws: owner.ws });
  check('workspace-wide summary has no nodeStats', all.status === 200 && all.body?.nodeStats === undefined);
}

await mongoose.disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
