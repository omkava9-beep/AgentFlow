/**
 * Collaboration check for spec/28 - the hub, ops, soft locks, catch-up and the
 * REST writers, as a runnable script. Needs a running server and its database:
 *
 *   PORT=4500 MONGODB_URI=...-check npm run dev                         # terminal 1
 *   BASE=http://localhost:4500/api MONGODB_URI=... npm run check:collab  # terminal 2
 *
 * Three real socket.io clients (owner, editor, viewer) share one workflow. Each
 * keeps its own replica of the graph built only from what the server sends it
 * (snapshot + broadcast ops + its own acks), and the replicas are compared with
 * the server's draft - convergence is asserted, not assumed.
 *
 * Timing-sensitive sections (lock TTL expiry, the flush ceiling) start their
 * own short-lived server with shortened COLLAB_* settings, like
 * integrationsCheck does for the live path.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { io } from 'socket.io-client';
import { applyOp, docFromWorkflow, docToPlain } from '../collab/ops.js';

let B = process.env.BASE || 'http://localhost:4500/api';
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
const newEmail = (tag) => `${tag}${uniq()}@collab.dev`;
async function register(tag, email = newEmail(tag)) {
  const r = await req('POST', '/auth/register', { body: { email, password: 'password123', name: tag } });
  return { token: r.body?.token, user: r.body?.user, email, ws: r.body?.workspaces?.[0]?.id };
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
const baseGraph = () => ({
  nodes: [N('s', 'start'), N('a1', 'agent', { systemPrompt: 'hi' }, 200), N('a2', 'agent', {}, 400), N('e', 'end', {}, 600)],
  edges: [{ id: 'e1', source: 's', target: 'a1' }, { id: 'e2', source: 'a1', target: 'a2' }, { id: 'e3', source: 'a2', target: 'e' }],
});
async function makeWorkflow(u, ws, name, g = baseGraph()) {
  const r = await req('POST', '/workflows', { body: { name }, token: u.token, ws });
  const put = await req('PUT', `/workflows/${r.body?._id}`, { body: g, token: u.token, ws });
  if (!ok2xx(put.status)) console.log('      makeWorkflow PUT failed', put.status, put.body);
  return r.body?._id;
}

const permissive = { permissions: new Set(['workflow:edit', 'code:author']), deletedIds: new Set(), lockedByOther: () => null };

/**
 * A socket.io client with its own graph replica. Remote ops (broadcasts) and
 * its own acked ops are both buffered by seq and applied strictly in order, so
 * the replica is exactly "what the server told this client".
 */
function client(u, label) {
  const socket = io(socketUrl(), { auth: { token: u.token }, transports: ['websocket'], forceNew: true, reconnection: false });
  const c = { u, label, socket, events: [], doc: null, seq: 0, buffer: new Map(), sessionId: null, acks: [] };
  socket.onAny((event, payload) => {
    c.events.push({ event, payload, at: Date.now() });
    if (event === 'collab:op') c.buffer.set(payload.seq, payload.op);
    c.drain();
  });
  c.load = (snap) => {
    c.doc = docFromWorkflow({ name: snap.name, nodes: snap.nodes, edges: snap.edges });
    c.seq = snap.seq;
    c.sessionId = snap.sessionId;
    for (const s of [...c.buffer.keys()]) if (s <= c.seq) c.buffer.delete(s);
  };
  socket.on('collab:snapshot', (snap) => c.load(snap));
  c.drain = () => {
    if (!c.doc) return;
    while (c.buffer.has(c.seq + 1)) {
      const op = c.buffer.get(c.seq + 1);
      c.buffer.delete(c.seq + 1);
      try { applyOp(c.doc, op, permissive); } catch (err) { c.applyError = err.message; }
      c.seq += 1;
    }
  };
  c.emit = (event, payload, timeout = 4000) => new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: 'timeout' }), timeout);
    socket.emit(event, payload, (ack) => { clearTimeout(t); resolve(ack); });
  });
  c.subscribe = async (workflowId, extra = {}) => {
    const ack = await c.emit('workflow:subscribe', { workflowId, ...extra });
    if (ack?.snapshot) c.load(ack.snapshot);
    if (ack?.catchUp) {
      for (const e of ack.catchUp.ops) c.buffer.set(e.seq, e.op);
      c.drain();
    }
    return ack;
  };
  c.op = async (workflowId, op) => {
    const full = { opId: crypto.randomUUID(), baseSeq: c.seq, ...op };
    const ack = await c.emit('collab:op', { workflowId, op: full });
    c.acks.push(ack);
    if (ack?.ok && !ack.duplicate) { c.buffer.set(ack.seq, full); c.drain(); }
    return { ...ack, op: full };
  };
  c.graph = () => (c.doc ? canonical(docToPlain(c.doc)) : null);
  c.waitFor = async (event, pred = () => true, ms = 3000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const hit = c.events.find((e) => e.event === event && pred(e.payload));
      if (hit) return hit.payload;
      await sleep(25);
    }
    return null;
  };
  c.count = (event, pred = () => true) => c.events.filter((e) => e.event === event && pred(e.payload)).length;
  c.connected = new Promise((resolve) => { socket.on('connect', () => resolve(true)); socket.on('connect_error', () => resolve(false)); });
  return c;
}

function canonical(g) {
  const sortBy = (arr) => [...arr].sort((a, b) => a.id.localeCompare(b.id));
  const norm = (v) => JSON.parse(JSON.stringify(v));
  return JSON.stringify({ name: g.name, nodes: sortBy(norm(g.nodes)), edges: sortBy(norm(g.edges)) });
}

async function serverDraft(u, ws, id) {
  const r = await req('GET', `/workflows/${id}`, { token: u.token, ws });
  return { status: r.status, body: r.body, canonical: r.body ? canonical({ name: r.body.name, nodes: r.body.nodes || [], edges: r.body.edges || [] }) : null };
}

// ======================================================================== setup
await mongoose.connect(DB_URI);
const db = () => mongoose.connection.db;

const owner = await register('owner');
const WS = (await req('POST', '/workspaces', { body: { name: `Collab ${uniq()}` }, token: owner.token })).body?.id;
const editor = await join(owner, WS, 'editor', 'eddie');
const viewer = await join(owner, WS, 'viewer', 'vera');
const outsider = await register('outsider');

const WF = await makeWorkflow(owner, WS, 'Collab flow');
const A = client(owner, 'owner');
const E = client(editor, 'editor');
const V = client(viewer, 'viewer');
const O = client(outsider, 'outsider');
await Promise.all([A.connected, E.connected, V.connected, O.connected]);

// ======================================================================== A
console.log('A. joining: snapshot, peers, presence');
{
  const a = await A.subscribe(WF);
  check('owner subscribe acks with a snapshot', a?.ok && a.snapshot && Array.isArray(a.snapshot.nodes), JSON.stringify(a).slice(0, 160));
  check('snapshot carries sessionId, seq, peers and locks', a?.snapshot?.sessionId && Number.isInteger(a.snapshot.seq) && Array.isArray(a.snapshot.peers) && Array.isArray(a.snapshot.locks));
  check('ack tells the client its socketId and color', a?.you?.socketId === A.socket.id && /^#/.test(a?.you?.color || ''));
  const e = await E.subscribe(WF);
  const v = await V.subscribe(WF);
  check('editor and viewer subscribe', e?.ok && v?.ok);
  check('viewer snapshot lists all three peers with roles', v?.snapshot?.peers?.length === 3 && ['owner', 'editor', 'viewer'].every((r) => v.snapshot.peers.some((p) => p.role === r)), JSON.stringify(v?.snapshot?.peers?.map((p) => p.role)));
  const joined = await A.waitFor('presence:join', (p) => p.userId === viewer.user.id);
  check('owner receives presence:join for the viewer (name, color, role)', joined && joined.name && joined.color && joined.role === 'viewer');
  const d = await serverDraft(owner, WS, WF);
  check('snapshot graph equals GET /workflows/:id', A.graph() === d.canonical && E.graph() === d.canonical && V.graph() === d.canonical);
  check('GET includes draftSeq', Number.isInteger(d.body?.draftSeq), `${d.body?.draftSeq}`);
  const o = await O.emit('workflow:subscribe', { workflowId: WF });
  check('outsider (another workspace) is refused: not_found', o?.ok === false && o.error === 'not_found');
  check('outsider receives no collab events', O.count('collab:op') === 0 && O.count('presence:join') === 0);
}

// ======================================================================== B
console.log('\nB. concurrent ops converge (per-field last writer wins)');
{
  const seqBefore = A.seq;
  const ownerOps = [];
  const editorOps = [];
  for (let i = 0; i < 15; i++) {
    ownerOps.push(A.op(WF, { type: 'node.update', nodeId: 'a1', path: ['label'], value: `owner-${i}` }));
    editorOps.push(E.op(WF, { type: 'node.update', nodeId: 'a1', path: ['label'], value: `editor-${i}` }));
    ownerOps.push(A.op(WF, { type: 'node.update', nodeId: 'a1', path: ['systemPrompt'], value: `prompt-${i}` }));
    editorOps.push(E.op(WF, { type: 'node.update', nodeId: 'a2', path: ['mockOverrides', 'failureRate'], value: i / 100 }));
    editorOps.push(E.op(WF, { type: 'node.move', nodeId: 'a2', position: { x: 400 + i, y: i } }));
  }
  const acks = await Promise.all([...ownerOps, ...editorOps]);
  check(`all ${acks.length} ops acked ok`, acks.every((a) => a.ok), JSON.stringify(acks.find((a) => !a.ok)));
  const seqs = acks.map((a) => a.seq);
  check('every op got a distinct seq', new Set(seqs).size === seqs.length);
  const monotonic = (list) => list.every((a, i) => i === 0 || a.seq > list[i - 1].seq);
  check('each client saw its own acks with increasing seq', monotonic(A.acks.slice(-30)) && monotonic(E.acks.slice(-45)));
  check('seqs are contiguous from the previous seq', Math.min(...seqs) === seqBefore + 1 && Math.max(...seqs) === seqBefore + acks.length);
  await sleep(300);
  const d = await serverDraft(owner, WS, WF);
  check('owner, editor and viewer replicas all equal the server draft', A.graph() === d.canonical && E.graph() === d.canonical && V.graph() === d.canonical,
    [A.graph() === d.canonical, E.graph() === d.canonical, V.graph() === d.canonical].join(','));
  const labelAcks = acks.filter((a) => a.op.path?.[0] === 'label');
  const winner = labelAcks.reduce((best, a) => (a.seq > best.seq ? a : best));
  const a1 = d.body.nodes.find((n) => n.id === 'a1');
  check('same field: the value with the highest seq wins', a1?.data?.config?.label === winner.op.value, `${a1?.data?.config?.label} vs ${winner.op.value}`);
  check('different fields of the same node both survive', a1?.data?.config?.systemPrompt === 'prompt-14');
  const a2 = d.body.nodes.find((n) => n.id === 'a2');
  check('nested path update landed (mockOverrides.failureRate)', a2?.data?.config?.mockOverrides?.failureRate === 0.14);
  check('final position from the last move', a2?.position?.x === 414 && a2?.position?.y === 14);
  check('viewer received every broadcast (no apply errors)', !V.applyError && V.seq === A.seq, `${V.seq}/${A.seq} ${V.applyError || ''}`);
}

// ======================================================================== C
console.log('\nC. validation and rejections');
{
  const r1 = await A.op(WF, { type: 'edge.add', edge: { id: 'back', source: 'a2', target: 'a1' } });
  check('edge closing a cycle → cycle', r1.ok === false && r1.reason === 'cycle', JSON.stringify(r1));
  // Two edges that are each fine but together form a cycle, sent at once.
  await A.op(WF, { type: 'node.add', node: N('x', 'agent', {}, 800) });
  await A.op(WF, { type: 'node.add', node: N('y', 'agent', {}, 900) });
  const [p, q] = await Promise.all([
    A.op(WF, { type: 'edge.add', edge: { id: 'xy', source: 'x', target: 'y' } }),
    E.op(WF, { type: 'edge.add', edge: { id: 'yx', source: 'y', target: 'x' } }),
  ]);
  check('of two edges that jointly form a cycle, exactly one is accepted', [p, q].filter((r) => r.ok).length === 1 && [p, q].some((r) => r.reason === 'cycle'), `${p.ok}/${p.reason} ${q.ok}/${q.reason}`);
  const self = await A.op(WF, { type: 'edge.add', edge: { id: 'selfie', source: 'x', target: 'x' } });
  check('self-loop → invalid', self.reason === 'invalid');
  const missing = await A.op(WF, { type: 'edge.add', edge: { id: 'ghost', source: 'x', target: 'nope' } });
  check('edge to a missing node → not_found', missing.reason === 'not_found');
  const dupEdge = await A.op(WF, { type: 'edge.add', edge: { id: 'e1', source: 'a2', target: 'x' } });
  check('duplicate edge id → duplicate', dupEdge.reason === 'duplicate');
  const start2 = await E.op(WF, { type: 'node.add', node: N('s2', 'start') });
  check('second Start node → invalid with an explanation', start2.reason === 'invalid' && /one Start/i.test(start2.message || ''), start2.message);
  const dupNode = await E.op(WF, { type: 'node.add', node: N('x', 'agent') });
  check('duplicate node id → duplicate', dupNode.reason === 'duplicate');
  const proto = await E.op(WF, { type: 'node.update', nodeId: 'x', path: ['__proto__', 'polluted'], value: 1 });
  check('__proto__ path → invalid', proto.reason === 'invalid');
  const big = await E.op(WF, { type: 'node.update', nodeId: 'x', path: ['systemPrompt'], value: 'z'.repeat(70 * 1024) });
  check('op over 64 KB → invalid', big.reason === 'invalid');
  const del = await A.op(WF, { type: 'node.delete', nodeId: 'y' });
  check('node.delete cascades its edges in the ack', del.ok && del.cascade?.edgeIds?.length >= 1, JSON.stringify(del.cascade));
  const bcast = await E.waitFor('collab:op', (pl) => pl.seq === del.seq);
  check('the broadcast carries the cascade too', bcast?.cascade?.edgeIds?.length >= 1);
  const gone = await E.op(WF, { type: 'node.update', nodeId: 'y', path: ['label'], value: 'late' });
  check('update of a node someone deleted → not_found', gone.reason === 'not_found');
  const cond = await A.op(WF, { type: 'node.add', node: N('c', 'condition', { expression: 'true' }, 700) });
  const condEdge = await A.op(WF, { type: 'edge.add', edge: { id: 'ce', source: 'c', target: 'x', sourceHandle: 'true' } });
  const relabel = await A.op(WF, { type: 'edge.update', edgeId: 'ce', field: 'label', value: 'nope' });
  check('relabeling a condition branch → invalid', cond.ok && condEdge.ok && relabel.reason === 'invalid', `${cond.ok} ${condEdge.ok} ${relabel.reason}`);
  const batchBad = await A.op(WF, { type: 'batch', ops: [{ type: 'node.add', node: N('bb', 'agent') }, { type: 'edge.add', edge: { id: 'bbx', source: 'bb', target: 'missing' } }] });
  const afterBad = await serverDraft(owner, WS, WF);
  check('batch is atomic: one bad op rejects all of it', batchBad.ok === false && !afterBad.body.nodes.some((n) => n.id === 'bb'));
  const batchGood = await A.op(WF, { type: 'batch', ops: [{ type: 'node.add', node: N('b1', 'agent', {}, 50) }, { type: 'node.add', node: N('b2', 'agent', {}, 60) }, { type: 'edge.add', edge: { id: 'b1b2', source: 'b1', target: 'b2' } }] });
  check('a valid batch applies with one seq', batchGood.ok && Number.isInteger(batchGood.seq));
  const vOp = await V.op(WF, { type: 'node.update', nodeId: 'x', path: ['label'], value: 'viewer was here' });
  check("viewer's op → forbidden", vOp.ok === false && vOp.reason === 'forbidden');
  const vLock = await V.emit('collab:lock', { workflowId: WF, nodeId: 'x' });
  check("viewer's lock → forbidden", vLock?.ok === false && vLock.reason === 'forbidden');
  const codeByEditor = await E.op(WF, { type: 'node.add', node: N('code1', 'code', { source: 'return 1' }) });
  check('editor adding a Code node → forbidden (code:author)', codeByEditor.reason === 'forbidden', JSON.stringify(codeByEditor));
  const codeByOwner = await A.op(WF, { type: 'node.add', node: N('code2', 'code', { source: 'return 1' }, 1000) });
  check('owner may add a Code node', codeByOwner.ok, JSON.stringify(codeByOwner));
  const srcEdit = await E.op(WF, { type: 'node.update', nodeId: 'code2', path: ['source'], value: 'return 2' });
  check("editor editing a Code node's source → forbidden", srcEdit.reason === 'forbidden');
  const codeLabel = await E.op(WF, { type: 'node.update', nodeId: 'code2', path: ['label'], value: 'Renamed code' });
  check("editor may still rename a Code node (only source is guarded)", codeLabel.ok);
  const unsubscribed = client(editor, 'stray');
  await unsubscribed.connected;
  const stray = await unsubscribed.op(WF, { type: 'node.update', nodeId: 'x', path: ['label'], value: 'stray' });
  check('op from a socket not subscribed to the workflow → forbidden', stray.reason === 'forbidden');
  unsubscribed.socket.disconnect();
  const unset = await A.op(WF, { type: 'node.update', nodeId: 'a1', path: ['systemPrompt'] });
  const afterUnset = await serverDraft(owner, WS, WF);
  check('node.update with no value unsets the path', unset.ok && !('systemPrompt' in (afterUnset.body.nodes.find((n) => n.id === 'a1')?.data?.config || {})));
  const legacy = await A.op(WF, { type: 'node.add', node: { id: 'lg', type: 'tool', position: { x: 1, y: 1 }, data: { config: { label: 'Old', toolType: 'calculator', toolConfig: { expression: '2+2' } } } } });
  const lgNode = (await serverDraft(owner, WS, WF)).body.nodes.find((n) => n.id === 'lg');
  check('a pasted phase-2 tool node is normalized to integration/action', legacy.ok && lgNode?.data?.config?.integration === 'builtin' && lgNode?.data?.config?.action === 'calculator', JSON.stringify(lgNode?.data?.config));
  const fakeConn = await A.op(WF, { type: 'node.update', nodeId: 'lg', path: ['connectionId'], value: new mongoose.Types.ObjectId().toString() });
  check("pointing a node at a connection that isn't this workspace's → invalid", fakeConn.reason === 'invalid', JSON.stringify(fakeConn));
  await sleep(200);
  const d = await serverDraft(owner, WS, WF);
  check('after all rejections, replicas still equal the draft', A.graph() === d.canonical && E.graph() === d.canonical && V.graph() === d.canonical);
}

// ======================================================================== D
console.log('\nD. duplicate ops are ignored');
{
  const opId = crypto.randomUUID();
  const op = { opId, baseSeq: A.seq, type: 'node.update', nodeId: 'x', path: ['counter'], value: 1 };
  const first = await A.emit('collab:op', { workflowId: WF, op });
  const again = await A.emit('collab:op', { workflowId: WF, op });
  check('resending the same opId acks with the original seq', first?.ok && again?.ok && again.seq === first.seq && again.duplicate === true, `${first?.seq} ${again?.seq}`);
  await sleep(200);
  check('the duplicate was broadcast once', E.count('collab:op', (p) => p.op?.opId === opId) === 1);
  if (first?.ok) { A.buffer.set(first.seq, op); A.drain(); }
}

// ======================================================================== E
console.log('\nE. soft locks');
{
  const l1 = await A.emit('collab:lock', { workflowId: WF, nodeId: 'x' });
  check('owner locks node x', l1?.ok === true);
  const lockedEvt = await E.waitFor('collab:locked', (p) => p.nodeId === 'x');
  check('others receive collab:locked with the holder', lockedEvt?.by?.userId === owner.user.id && lockedEvt?.by?.name);
  const l2 = await E.emit('collab:lock', { workflowId: WF, nodeId: 'x' });
  check('editor trying to lock gets heldBy the owner', l2?.ok === false && l2.heldBy?.userId === owner.user.id && l2.heldBy?.sameUser === false);
  const blocked = await E.op(WF, { type: 'node.update', nodeId: 'x', path: ['label'], value: 'mine' });
  check('editor node.update on the locked node → locked (with heldBy)', blocked.reason === 'locked' && blocked.heldBy?.userId === owner.user.id);
  const blockedDel = await E.op(WF, { type: 'node.delete', nodeId: 'x' });
  check('editor node.delete on the locked node → locked', blockedDel.reason === 'locked');
  const move = await E.op(WF, { type: 'node.move', nodeId: 'x', position: { x: 123, y: 45 } });
  check('moves are never locked', move.ok);
  const own = await A.op(WF, { type: 'node.update', nodeId: 'x', path: ['label'], value: 'holder edit' });
  check('the holder can still edit it', own.ok);
  const hb = await A.emit('collab:lock_heartbeat', { workflowId: WF, nodeId: 'x' });
  check('heartbeat from the holder is acked', hb?.ok === true);
  const un = await A.emit('collab:unlock', { workflowId: WF, nodeId: 'x' });
  const unEvt = await E.waitFor('collab:unlocked', (p) => p.nodeId === 'x');
  check('unlock releases and broadcasts collab:unlocked', un?.ok && unEvt);
  const l3 = await E.emit('collab:lock', { workflowId: WF, nodeId: 'x' });
  check('now the editor can take it', l3?.ok === true);
  const snap = await (async () => { const late = client(owner, 'late'); await late.connected; const ack = await late.subscribe(WF); late.socket.disconnect(); return ack; })();
  check("a late joiner's snapshot lists the lock", snap?.snapshot?.locks?.some((l) => l.nodeId === 'x' && l.userId === editor.user.id));
  // Same user, second tab.
  const tab2 = client(editor, 'editor-tab2');
  await tab2.connected;
  await tab2.subscribe(WF);
  const other = await tab2.emit('collab:lock', { workflowId: WF, nodeId: 'x' });
  check("the same user's other tab sees heldBy.sameUser", other?.ok === false && other.heldBy?.sameUser === true);
  tab2.socket.disconnect();
  // Disconnect releases.
  const eAgain = E;
  eAgain.socket.disconnect();
  const released = await A.waitFor('collab:unlocked', (p) => p.nodeId === 'x' && A.events.filter((e) => e.event === 'collab:unlocked').length >= 2);
  check('disconnecting releases the lock', Boolean(released));
  const left = await A.waitFor('presence:leave', (p) => p.userId === editor.user.id);
  check('and the others get presence:leave', Boolean(left));
  const l4 = await A.emit('collab:lock', { workflowId: WF, nodeId: 'x' });
  check('the owner can lock it again after the disconnect', l4?.ok === true);
  await A.emit('collab:unlock', { workflowId: WF, nodeId: 'x' });
}

// Re-connect the editor for the rest of the suite.
const E2 = client(editor, 'editor2');
await E2.connected;

// ======================================================================== F
console.log('\nF. late join, reconnect catch-up, restart detection');
{
  const sub = await E2.subscribe(WF);
  const d0 = await serverDraft(owner, WS, WF);
  check("a late joiner's snapshot equals the draft", sub?.snapshot && E2.graph() === d0.canonical);
  const { sessionId } = sub.snapshot;
  const mark = E2.seq;
  // Go away (as a dropped connection would), miss three ops, come back.
  await E2.emit('workflow:unsubscribe', { workflowId: WF });
  for (let i = 0; i < 3; i++) await A.op(WF, { type: 'node.update', nodeId: 'a2', path: ['label'], value: `while-away-${i}` });
  const back = await E2.subscribe(WF, { sinceSeq: sub.snapshot.seq, sessionId });
  check('resubscribing with sinceSeq + sessionId returns a catch-up, not a snapshot', back?.ok && back.catchUp && !back.snapshot, Object.keys(back || {}).join(','));
  check('catch-up contains exactly the missed ops', back?.catchUp?.ops?.length === A.seq - mark && back.catchUp.ops.every((o, i, arr) => i === 0 || o.seq === arr[i - 1].seq + 1), `${back?.catchUp?.ops?.length} vs ${A.seq - mark}`);
  const d1 = await serverDraft(owner, WS, WF);
  check('after catch-up the replica equals the draft', E2.graph() === d1.canonical);
  const joinsBefore = A.count('presence:join', (p) => p.socketId === E2.socket.id);
  const current = await E2.subscribe(WF, { sinceSeq: E2.seq, sessionId });
  check('sinceSeq == current seq → empty catch-up', current?.catchUp?.ops?.length === 0);
  const stale = await E2.subscribe(WF, { sinceSeq: 3, sessionId: 'not-this-session' });
  check("a stale sessionId gets a snapshot marked server_restarted", stale?.snapshot?.reason === 'server_restarted');
  const joinsAfter = A.count('presence:join', (p) => p.socketId === E2.socket.id);
  check('re-subscribing while already joined does not announce a duplicate presence:join', joinsAfter === joinsBefore, `${joinsBefore} → ${joinsAfter}`);
}

// ======================================================================== G
console.log('\nG. REST writers go through the hub');
{
  const g = baseGraph();
  g.nodes[1].data.config.label = 'Replaced by PUT';
  const put = await req('PUT', `/workflows/${WF}`, { body: { ...g, name: 'Replaced' }, token: owner.token, ws: WS });
  check('PUT with peers connected succeeds', ok2xx(put.status) && Number.isInteger(put.body?.draftSeq), `${put.status} ${put.body?.error || ''}`);
  const [sa, se, sv] = await Promise.all([A, E2, V].map((c) => c.waitFor('collab:snapshot', (p) => p.reason === 'replaced')));
  check('owner, editor and viewer all receive collab:snapshot (replaced)', sa && se && sv);
  check('the snapshot names who replaced it', sa?.by?.userId === owner.user.id);
  await sleep(100);
  const d = await serverDraft(owner, WS, WF);
  check('replicas equal the replaced draft', A.graph() === d.canonical && E2.graph() === d.canonical && V.graph() === d.canonical);
  check('GET returns the replaced graph', d.body?.name === 'Replaced' && d.body.nodes.some((n) => n.data?.config?.label === 'Replaced by PUT'));
  const cyc = await req('PUT', `/workflows/${WF}`, { body: { nodes: g.nodes, edges: [...g.edges, { id: 'loop', source: 'e', target: 's' }] }, token: owner.token, ws: WS });
  check('a PUT with a cycle is still rejected (400)', cyc.status === 400);
  const after = await A.op(WF, { type: 'node.update', nodeId: 'a2', path: ['label'], value: 'after replace' });
  check('ops keep working after a replace, with seq continuing', after.ok && after.seq > sa.seq);
}

// ======================================================================== H
console.log('\nH. flushing to MongoDB, and runs use the live graph');
{
  await A.op(WF, { type: 'node.update', nodeId: 'a1', path: ['label'], value: 'flush me' });
  const labelIn = (doc) => doc?.nodes?.find((n) => n.id === 'a1')?.data?.config?.label;
  await sleep(1600);
  const later = await db().collection('workflows').findOne({ _id: new mongoose.Types.ObjectId(WF) });
  check('it reaches MongoDB after the debounce', labelIn(later) === 'flush me', labelIn(later));
  check('draftSeq and updatedBy are persisted', later?.draftSeq === A.seq && String(later?.updatedBy) === owner.user.id, `${later?.draftSeq}/${A.seq}`);
  // A run started right after an edit executes the edit, not the stale DB copy.
  await A.op(WF, { type: 'batch', ops: [
    { type: 'node.add', node: N('e2', 'end', {}, 700) },
    { type: 'edge.add', edge: { id: 'to-e2', source: 'a2', target: 'e2' } },
  ] });
  const run = await req('POST', `/workflows/${WF}/runs`, { token: owner.token, ws: WS });
  check('run starts', run.status === 202, `${run.status} ${run.body?.error || ''}`);
  let runDoc = null;
  for (let i = 0; i < 60 && run.body?.runId; i++) {
    runDoc = (await req('GET', `/runs/${run.body.runId}`, { token: owner.token, ws: WS })).body;
    if (['success', 'failed', 'cancelled'].includes(runDoc?.status)) break;
    await sleep(200);
  }
  check('the run used the just-edited graph (includes node e2)', runDoc?.nodeResults?.some((r) => r.nodeId === 'e2'), runDoc?.nodeResults?.map((r) => r.nodeId).join(','));
  const flushedForRun = await db().collection('workflows').findOne({ _id: new mongoose.Types.ObjectId(WF) });
  check('starting the run flushed the draft first', flushedForRun?.nodes?.some((n) => n.id === 'e2'));
  const tpl = await req('POST', '/templates', { body: { workflowId: WF, name: `Collab tpl ${uniq()}` }, token: owner.token, ws: WS });
  await A.op(WF, { type: 'node.update', nodeId: 'a1', path: ['label'], value: 'after template' });
  check('save-as-template works mid-session', ok2xx(tpl.status), `${tpl.status} ${tpl.body?.error || ''}`);
}

// ======================================================================== I
console.log('\nI. role changes and triggers');
{
  // Editor takes a lock, then gets demoted.
  const lk = await E2.emit('collab:lock', { workflowId: WF, nodeId: 'a2' });
  check('editor holds a lock on a2', lk?.ok === true);
  const dem = await req('PATCH', `/workspaces/${WS}/members/${editor.user.id}`, { body: { role: 'viewer' }, token: owner.token });
  check('owner demotes the editor to viewer', ok2xx(dem.status));
  const rel = await A.waitFor('collab:unlocked', (p) => p.nodeId === 'a2');
  check("the demoted user's lock is released", Boolean(rel));
  const reAnnounced = await A.waitFor('presence:join', (p) => p.socketId === E2.socket.id && p.role === 'viewer');
  check('peers see the new role (presence:join re-announced)', Boolean(reAnnounced));
  const nope = await E2.op(WF, { type: 'node.update', nodeId: 'a2', path: ['label'], value: 'demoted' });
  check("the demoted user's ops are rejected: forbidden", nope.reason === 'forbidden');
  await req('PATCH', `/workspaces/${WS}/members/${editor.user.id}`, { body: { role: 'editor' }, token: owner.token });
  await sleep(150);
  const yes = await E2.op(WF, { type: 'node.update', nodeId: 'a2', path: ['label'], value: 'promoted back' });
  check('promoted back: ops accepted again', yes.ok, JSON.stringify(yes));
  // Trigger changes are broadcast without the webhook token.
  const regen = await req('POST', `/workflows/${WF}/webhook/regenerate`, { token: owner.token, ws: WS });
  const trig = await V.waitFor('workflow:triggers_changed', (p) => p.triggers?.webhook?.hasToken === true);
  check('viewer receives workflow:triggers_changed after a trigger write', Boolean(trig), `${regen.status}`);
  check('…and it never carries the webhook token', trig && !JSON.stringify(trig).includes(regen.body?.token || '@@none@@'));
  // Removal evicts from the session.
  const vRm = await req('DELETE', `/workspaces/${WS}/members/${viewer.user.id}`, { token: owner.token });
  const vLeft = await A.waitFor('presence:leave', (p) => p.userId === viewer.user.id);
  check('removing a member drops them from the session (presence:leave)', ok2xx(vRm.status) && Boolean(vLeft));
  const vAfter = await V.op(WF, { type: 'node.update', nodeId: 'a2', path: ['label'], value: 'evicted' });
  check("the removed member's op is forbidden", vAfter.reason === 'forbidden');
}

// ======================================================================== J
console.log('\nJ. presence relay');
{
  // Cursor and drag are volatile (may be dropped under a burst), so they're
  // spaced out here the way a throttled client sends them.
  A.socket.emit('presence:cursor', { workflowId: WF, x: 12.5, y: 99 });
  await sleep(60);
  A.socket.emit('presence:select', { workflowId: WF, nodeIds: ['a1'], edgeIds: [] });
  A.socket.emit('presence:drag', { workflowId: WF, moves: [{ nodeId: 'a1', position: { x: 1, y: 2 } }] });
  await sleep(60);
  A.socket.emit('presence:state', { workflowId: WF, away: true });
  const cur = await E2.waitFor('presence:cursor', (p) => p.x === 12.5);
  const sel = await E2.waitFor('presence:select', (p) => p.nodeIds?.[0] === 'a1');
  const drag = await E2.waitFor('presence:drag', (p) => p.moves?.[0]?.nodeId === 'a1');
  const away = await E2.waitFor('presence:state', (p) => p.away === true);
  check('cursor, select, drag and away are relayed with socketId', cur?.socketId === A.socket.id && sel && drag && away, `cursor=${Boolean(cur)} select=${Boolean(sel)} drag=${Boolean(drag)} away=${Boolean(away)}`);
  check('presence is not echoed back to the sender', A.count('presence:cursor') === 0);
  const beforeSeq = A.seq;
  await sleep(100);
  check('presence never consumes a seq', A.seq === beforeSeq && E2.seq === beforeSeq);
  const junk = client(owner, 'junk'); await junk.connected;
  junk.socket.emit('presence:cursor', { workflowId: WF, x: 777, y: 1 });
  await sleep(200);
  check("presence from a socket that hasn't joined is dropped", E2.count('presence:cursor', (p) => p.x === 777) === 0);
  junk.socket.disconnect();
}

// ======================================================================== K
console.log('\nK. deleting the workflow closes the session');
{
  const rm = await req('DELETE', `/workflows/${WF}`, { token: owner.token, ws: WS });
  const [ca, ce] = await Promise.all([A.waitFor('collab:closed'), E2.waitFor('collab:closed')]);
  check('delete → collab:closed { reason: deleted, by } on every peer', rm.status === 204 && ca?.reason === 'deleted' && ce?.by?.userId === owner.user.id);
  const after = await A.op(WF, { type: 'node.update', nodeId: 'a1', path: ['label'], value: 'ghost' });
  check('ops after close are rejected', after.ok === false);
  await sleep(1500);
  const doc = await db().collection('workflows').findOne({ _id: new mongoose.Types.ObjectId(WF) });
  check('no pending flush resurrects the deleted workflow', doc === null);
}

for (const c of [A, E2, V, O]) c.socket.disconnect();

// ======================================================================== L
console.log('\nL. timings (own server with shortened COLLAB_* settings)');
{
  const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const port = 4700 + Math.floor(Math.random() * 90);
  const dbUri = `${DB_URI.replace(/\/+$/, '')}-collabtiming`;
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(port), MONGODB_URI: dbUri, COLLAB_FLUSH_DEBOUNCE_MS: '200', COLLAB_FLUSH_MAX_MS: '700', COLLAB_LOCK_TTL_MS: '1200', INTEGRATIONS_LIVE: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const mainBase = B;
  B = `http://localhost:${port}/api`;
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    try { up = (await fetch(`${B}/health`)).ok; } catch { /* not yet */ }
    if (!up) await sleep(150);
  }
  check('timing server started', up, up ? '' : log.slice(-400));
  if (up) {
    const conn = await mongoose.createConnection(dbUri).asPromise();
    const u1 = await register('t-owner');
    const u2 = await join(u1, u1.ws, 'editor', 't-editor');
    const wf = await makeWorkflow(u1, u1.ws, 'Timing');
    const c1 = client(u1, 't1');
    const c2 = client(u2, 't2');
    await Promise.all([c1.connected, c2.connected]);
    await c1.subscribe(wf);
    await c2.subscribe(wf);
    const lk = await c1.emit('collab:lock', { workflowId: wf, nodeId: 'a1' });
    check('lock taken (TTL 1.2 s)', lk?.ok === true);
    const expired = await c2.waitFor('collab:unlocked', (p) => p.nodeId === 'a1' && p.reason === 'expired', 4000);
    check('an idle lock expires past its TTL and is broadcast as expired', Boolean(expired));
    const take = await c2.emit('collab:lock', { workflowId: wf, nodeId: 'a1' });
    check('another editor can take the expired lock', take?.ok === true);
    // Heartbeats keep a lock alive past the TTL.
    for (let i = 0; i < 4; i++) { await sleep(500); await c2.emit('collab:lock_heartbeat', { workflowId: wf, nodeId: 'a1' }); }
    const stillHeld = await c1.emit('collab:lock', { workflowId: wf, nodeId: 'a1' });
    check('heartbeats keep the lock alive beyond the TTL', stillHeld?.ok === false && stillHeld.heldBy?.userId === u2.user.id);
    // Continuous editing still persists within the flush ceiling.
    const t0 = Date.now();
    let persistedDuringBurst = false;
    for (let i = 0; i < 20; i++) {
      await c1.op(wf, { type: 'node.update', nodeId: 'a2', path: ['label'], value: `burst-${i}` });
      await sleep(100);
      const doc = await conn.collection('workflows').findOne({ _id: new mongoose.Types.ObjectId(wf) });
      const label = doc?.nodes?.find((n) => n.id === 'a2')?.data?.config?.label || '';
      if (label.startsWith('burst-') && Date.now() - t0 < 1500) persistedDuringBurst = true;
    }
    check('during a continuous burst, edits reach MongoDB within the flush ceiling', persistedDuringBurst);
    // Last one out flushes immediately.
    await c1.op(wf, { type: 'node.update', nodeId: 'a2', path: ['label'], value: 'last words' });
    await c1.emit('workflow:unsubscribe', { workflowId: wf });
    await c2.emit('workflow:unsubscribe', { workflowId: wf });
    await sleep(150);
    const doc = await conn.collection('workflows').findOne({ _id: new mongoose.Types.ObjectId(wf) });
    check('the last peer leaving flushes the draft', doc?.nodes?.find((n) => n.id === 'a2')?.data?.config?.label === 'last words');
    c1.socket.disconnect(); c2.socket.disconnect();
    // Shutdown flush: edit, then SIGTERM right away.
    const c3 = client(u1, 't3'); await c3.connected; await c3.subscribe(wf);
    await c3.op(wf, { type: 'workflow.rename', name: 'Renamed before shutdown' });
    child.kill('SIGTERM');
    await new Promise((r) => { child.once('exit', r); setTimeout(r, 5000); });
    const final = await conn.collection('workflows').findOne({ _id: new mongoose.Types.ObjectId(wf) });
    check('SIGTERM flushes open drafts before exiting', final?.name === 'Renamed before shutdown', final?.name);
    c3.socket.disconnect();
    await conn.dropDatabase();
    await conn.close();
  }
  if (child.exitCode === null) child.kill('SIGKILL');
  B = mainBase;
}

// ======================================================================== M
console.log('\nM. ops unit checks');
{
  const doc = docFromWorkflow(baseGraph());
  const ctx = { permissions: new Set(['workflow:edit']), deletedIds: new Set(), lockedByOther: () => null };
  const del = applyOp(doc, { type: 'node.delete', nodeId: 'a1' }, ctx);
  check('delete reports the removed node for the spec/29 hook', del.deleted[0]?.nodeId === 'a1' && del.deleted[0]?.lastKnownNode?.id === 'a1');
  ctx.deletedIds.add('a1');
  const back = applyOp(doc, { type: 'batch', ops: [
    { type: 'node.add', node: N('a1', 'agent', { systemPrompt: 'hi' }, 200) },
    { type: 'edge.add', edge: { id: 'e1', source: 's', target: 'a1' } },
    { type: 'edge.add', edge: { id: 'e2', source: 'a1', target: 'a2' } },
  ] }, ctx);
  check('undoing a delete (same id) reports it as restored', back.restored.includes('a1'));
  check('the restored graph matches the original', canonical(docToPlain(doc)) === canonical(baseGraph()));
  let threw = null;
  try { applyOp(doc, { type: 'node.update', nodeId: 'a1', path: ['constructor', 'x'], value: 1 }, ctx); } catch (err) { threw = err.reason; }
  check('prototype-path writes are refused', threw === 'invalid');
}

await mongoose.disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
