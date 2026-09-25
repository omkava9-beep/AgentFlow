/**
 * Comments, mentions & notifications check for spec/29, as a runnable script.
 * Needs a running server and its database:
 *
 *   PORT=4500 MONGODB_URI=...-check npm run dev                            # terminal 1
 *   BASE=http://localhost:4500/api MONGODB_URI=... npm run check:comments   # terminal 2
 *
 * Real socket.io clients watch the workflow room and the user rooms, so live
 * sync (`comment:*`, `notification:*`) is asserted from what actually arrives,
 * and the node-delete/undo anchor rules are driven through spec/28's own ops.
 */
import crypto from 'node:crypto';
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
  return { status: res.status, body: json, text };
}

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const newEmail = (tag) => `${tag}${uniq()}@comments.dev`;
async function register(tag, email = newEmail(tag)) {
  const r = await req('POST', '/auth/register', { body: { email, password: 'password123', name: tag } });
  return { token: r.body?.token, user: r.body?.user, id: r.body?.user?.id, email, ws: r.body?.workspaces?.[0]?.id, slug: r.body?.workspaces?.[0]?.slug };
}
async function invite(owner, ws, email, role) {
  return req('POST', `/workspaces/${ws}/invitations`, { body: { email, role }, token: owner.token });
}
async function join(owner, ws, role, tag = role) {
  const email = newEmail(tag);
  const inv = await invite(owner, ws, email, role);
  const u = await register(tag, email);
  const token = String(inv.body?.inviteUrl || '').split('/invite/').pop();
  await req('POST', `/invitations/${token}/accept`, { token: u.token });
  return u;
}
async function joinExisting(owner, ws, u, role) {
  const inv = await invite(owner, ws, u.email, role);
  const token = String(inv.body?.inviteUrl || '').split('/invite/').pop();
  return req('POST', `/invitations/${token}/accept`, { token: u.token });
}

const N = (id, type, config = {}, x = 0) => ({ id, type, position: { x, y: 40 }, data: { config: { label: id, ...config } } });
const graph = () => ({
  nodes: [N('s', 'start'), N('a1', 'agent', { systemPrompt: 'hi' }, 200), N('e', 'end', {}, 400)],
  edges: [{ id: 'e1', source: 's', target: 'a1' }, { id: 'e2', source: 'a1', target: 'e' }],
});
async function makeWorkflow(u, ws, name, g = graph()) {
  const r = await req('POST', '/workflows', { body: { name }, token: u.token, ws });
  await req('PUT', `/workflows/${r.body?._id}`, { body: g, token: u.token, ws });
  return r.body?._id;
}

function client(u) {
  const socket = io(socketUrl(), { auth: { token: u.token }, transports: ['websocket'], forceNew: true, reconnection: false });
  const c = { socket, events: [], seq: 0 };
  socket.onAny((event, payload) => {
    c.events.push({ event, payload });
    if (event === 'collab:op' && payload?.seq > c.seq) c.seq = payload.seq;
  });
  c.emit = (event, payload, timeout = 4000) => new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: 'timeout' }), timeout);
    socket.emit(event, payload, (ack) => { clearTimeout(t); resolve(ack); });
  });
  c.subscribe = async (workflowId) => {
    const ack = await c.emit('workflow:subscribe', { workflowId });
    if (ack?.snapshot) c.seq = ack.snapshot.seq;
    return ack;
  };
  c.op = async (workflowId, op) => {
    const ack = await c.emit('collab:op', { workflowId, op: { opId: crypto.randomUUID(), baseSeq: c.seq, ...op } });
    if (ack?.ok && ack.seq > c.seq) c.seq = ack.seq;
    return ack;
  };
  c.of = (event) => c.events.filter((e) => e.event === event).map((e) => e.payload);
  c.wait = async (pred, ms = 3000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const hit = c.events.find((e) => pred(e.event, e.payload));
      if (hit) return hit.payload;
      await sleep(40);
    }
    return null;
  };
  c.ready = new Promise((resolve) => socket.on('connect', resolve));
  return c;
}

async function waitFor(fn, ms = 4000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await fn();
    if (v) return v;
    await sleep(80);
  }
  return fn();
}

await mongoose.connect(DB_URI);
const db = mongoose.connection.db;
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const threadDoc = (id) => db.collection('commentthreads').findOne({ _id: oid(id) }).catch(() => null);
const notifs = (userId, extra = {}) => db.collection('notifications').find({ userId: oid(userId), ...extra }).toArray();
const listNotifs = async (u, q = '') => req('GET', `/notifications${q}`, { token: u.token });

// ---------------------------------------------------------------- setup
const owner = await register('Olive');
const team = await req('POST', '/workspaces', { body: { name: `Comments Team ${uniq()}` }, token: owner.token });
const WS = team.body?.id;
const SLUG = team.body?.slug;
await req('PATCH', `/workspaces/${WS}/plan`, { body: { plan: 'enterprise' }, token: owner.token });
const editor = await join(owner, WS, 'editor', 'Eddie');
const viewer = await join(owner, WS, 'viewer', 'Vera');
const admin = await join(owner, WS, 'admin', 'Adam');
const outsider = await register('Otto');
const WF = await makeWorkflow(owner, WS, 'Review me');

const cOwner = client(owner);
const cEditor = client(editor);
const cEditor2 = client(editor); // a second tab of the same person
await Promise.all([cOwner.ready, cEditor.ready, cEditor2.ready]);
await cOwner.subscribe(WF);
await cEditor.subscribe(WF);

// ---------------------------------------------------------------- A. threads + live sync
console.log('A. threads, replies and live sync over workflow:<id>');
let T1;
{
  const r = await req('POST', `/workflows/${WF}/threads`, { body: { anchor: { type: 'node', nodeId: 'a1' }, body: 'Is this prompt right?' }, token: owner.token, ws: WS });
  T1 = r.body?.id;
  check('owner opens a node-pinned thread -> 201', r.status === 201 && r.body?.anchor?.nodeId === 'a1' && r.body?.comments?.length === 1, `${r.status}`);
  const live = await cEditor.wait((e, p) => e === 'comment:created' && p?.threadId === T1);
  check('editor socket receives comment:created with the new thread', Boolean(live?.thread && live?.comment?.body === 'Is this prompt right?'));
  const rep = await req('POST', `/threads/${T1}/comments`, { body: { body: 'Looks fine to me' }, token: editor.token, ws: WS });
  check('editor replies -> 201', rep.status === 201 && rep.body?.author?.id === editor.id, `${rep.status}`);
  const live2 = await cOwner.wait((e, p) => e === 'comment:created' && p?.comment?.id === rep.body?.id);
  check('owner socket receives the reply live (no thread field on replies)', Boolean(live2) && !live2.thread);
  const list = await req('GET', `/workflows/${WF}/threads`, { token: viewer.token, ws: WS });
  const t = (list.body || []).find((x) => x.id === T1);
  check('thread list returns comments with author names in order', t?.comments?.length === 2 && t.comments[0].author?.name === 'Olive' && t.replyCount === 1);
  const canvas = await req('POST', `/workflows/${WF}/threads`, { body: { anchor: { type: 'canvas', x: 120, y: -30 }, body: 'This whole branch is slow' }, token: editor.token, ws: WS });
  check('canvas-position thread -> 201', canvas.status === 201 && canvas.body?.anchor?.type === 'canvas' && canvas.body.anchor.x === 120);
  const empty = await req('POST', `/threads/${T1}/comments`, { body: { body: '   ' }, token: editor.token, ws: WS });
  check('whitespace-only body -> 400', empty.status === 400);
  const long = await req('POST', `/threads/${T1}/comments`, { body: { body: 'x'.repeat(4001) }, token: editor.token, ws: WS });
  check('body over 4000 chars -> 400', long.status === 400);
  const gone = await req('POST', `/workflows/${WF}/threads`, { body: { anchor: { type: 'node', nodeId: 'nope' }, body: 'hi' }, token: editor.token, ws: WS });
  check('node anchor on a missing node -> 409 node_missing', gone.status === 409 && gone.body?.code === 'node_missing', `${gone.status} ${JSON.stringify(gone.body)}`);
}

// ---------------------------------------------------------------- B. viewers comment but can't edit
console.log('\nB. viewers can comment, reply and resolve, and still cannot change the graph');
{
  const vt = await req('POST', `/workflows/${WF}/threads`, { body: { anchor: { type: 'node', nodeId: 'e' }, body: 'Viewer question' }, token: viewer.token, ws: WS });
  check('viewer creates a thread', vt.status === 201, `${vt.status}`);
  const vr = await req('POST', `/threads/${T1}/comments`, { body: { body: 'Viewer reply' }, token: viewer.token, ws: WS });
  check('viewer replies', vr.status === 201);
  const res = await req('POST', `/threads/${vt.body?.id}/resolve`, { token: viewer.token, ws: WS });
  check('viewer resolves a thread', res.status === 200 && Boolean(res.body?.resolvedAt));
  const liveRes = await cEditor.wait((e, p) => e === 'comment:resolved' && p?.threadId === vt.body?.id);
  check('comment:resolved broadcast', liveRes?.resolved === true);
  const onlyOpen = await req('GET', `/workflows/${WF}/threads?resolved=false`, { token: viewer.token, ws: WS });
  check('?resolved=false hides resolved threads', !(onlyOpen.body || []).some((t) => t.id === vt.body?.id));
  const reopen = await req('POST', `/threads/${vt.body?.id}/reopen`, { token: viewer.token, ws: WS });
  check('reopen clears resolvedAt', reopen.status === 200 && reopen.body?.resolvedAt === null);
  const put = await req('PUT', `/workflows/${WF}`, { body: graph(), token: viewer.token, ws: WS });
  check('viewer still cannot PUT the graph (403)', put.status === 403);
}

// ---------------------------------------------------------------- C. edit / delete / moderate
console.log('\nC. edit own, delete own, moderators delete anyone\'s');
{
  const t = await req('POST', `/workflows/${WF}/threads`, { body: { anchor: { type: 'canvas', x: 0, y: 0 }, body: 'Opening' }, token: editor.token, ws: WS });
  const tid = t.body?.id;
  const firstId = t.body?.comments?.[0]?.id;
  const r1 = await req('POST', `/threads/${tid}/comments`, { body: { body: 'editor reply' }, token: editor.token, ws: WS });
  const r2 = await req('POST', `/threads/${tid}/comments`, { body: { body: 'viewer reply' }, token: viewer.token, ws: WS });
  const ed = await req('PATCH', `/comments/${r1.body?.id}`, { body: { body: 'editor reply (edited)' }, token: editor.token, ws: WS });
  check('author edits own comment -> editedAt set', ed.status === 200 && Boolean(ed.body?.editedAt) && ed.body.body === 'editor reply (edited)');
  const liveEd = await cOwner.wait((e, p) => e === 'comment:updated' && p?.comment?.id === r1.body?.id);
  check('comment:updated broadcast', Boolean(liveEd));
  const notAuthor = await req('PATCH', `/comments/${r1.body?.id}`, { body: { body: 'owner rewrites' }, token: owner.token, ws: WS });
  check('nobody else can edit it, not even the owner (403)', notAuthor.status === 403);
  const vDel = await req('DELETE', `/comments/${r1.body?.id}`, { token: viewer.token, ws: WS });
  check("viewer can't delete someone else's comment (403)", vDel.status === 403);
  const eDel = await req('DELETE', `/comments/${r2.body?.id}`, { token: editor.token, ws: WS });
  check("editor (no comments:moderate) can't delete someone else's comment (403)", eDel.status === 403);
  const own = await req('DELETE', `/comments/${r2.body?.id}`, { token: viewer.token, ws: WS });
  check('viewer deletes own reply -> 204', own.status === 204);
  const aDel = await req('DELETE', `/comments/${r1.body?.id}`, { token: admin.token, ws: WS });
  check("admin (comments:moderate) deletes someone else's reply -> 204", aDel.status === 204);
  const after = (await req('GET', `/workflows/${WF}/threads`, { token: owner.token, ws: WS })).body.find((x) => x.id === tid);
  check('deleted replies stay as placeholders, in order', after?.comments?.length === 3 && after.comments[1].deleted && after.comments[1].body === '' && after.comments[2].deleted);
  const delFirst = await req('DELETE', `/comments/${firstId}`, { token: editor.token, ws: WS });
  check('deleting the opening comment -> 204', delFirst.status === 204);
  const liveDel = await cOwner.wait((e, p) => e === 'comment:deleted' && p?.threadId === tid && p?.threadDeleted);
  check('comment:deleted with threadDeleted: true', Boolean(liveDel));
  check('the whole thread and its comments are gone', !(await threadDoc(tid)) && (await db.collection('comments').countDocuments({ threadId: oid(tid) })) === 0);
}

// ---------------------------------------------------------------- D. mentions
console.log('\nD. @mentions: members only, never the author');
{
  const before = { editor: (await notifs(editor.id, { kind: 'mention' })).length, owner: (await notifs(owner.id, { kind: 'mention' })).length, outsider: (await notifs(outsider.id)).length };
  const body = `Hey {{@${editor.id}}} and {{@${outsider.id}}} and me {{@${owner.id}}}, thoughts?`;
  const r = await req('POST', `/workflows/${WF}/threads`, { body: { anchor: { type: 'node', nodeId: 's' }, body }, token: owner.token, ws: WS });
  check('comment with mentions -> 201', r.status === 201);
  const c = r.body?.comments?.[0];
  check('mentions keep members only (editor + author), outsider dropped', c && c.mentions.map((m) => m.id).sort().join() === [editor.id, owner.id].sort().join(), JSON.stringify(c?.mentions));
  check("outsider's token rewritten to plain text", c && !c.body.includes(outsider.id) && c.body.includes('@someone'));
  const pushed = await cEditor.wait((e, p) => e === 'notification:new' && p?.kind === 'mention' && p?.link?.includes(r.body?.id));
  check('mentioned editor gets notification:new live, with unreadCount', Boolean(pushed) && typeof pushed.unreadCount === 'number' && pushed.workspace?.slug === SLUG);
  await sleep(200);
  check('exactly one mention notification for the editor', (await notifs(editor.id, { kind: 'mention' })).length === before.editor + 1);
  check('the author gets none for mentioning themselves', (await notifs(owner.id, { kind: 'mention' })).length === before.owner);
  check('the non-member gets nothing', (await notifs(outsider.id)).length === before.outsider);
  check('link opens the thread in its workspace', pushed?.link === `/w/${SLUG}/workflows/${WF}?thread=${r.body?.id}`, pushed?.link);
}

// ---------------------------------------------------------------- E. replies notify participants
console.log('\nE. a reply notifies every earlier participant except the replier');
{
  const t = await req('POST', `/workflows/${WF}/threads`, { body: { anchor: { type: 'canvas', x: 5, y: 5 }, body: 'Kickoff' }, token: owner.token, ws: WS });
  const tid = t.body?.id;
  await req('POST', `/threads/${tid}/comments`, { body: { body: 'Editor was here' }, token: editor.token, ws: WS });
  const count = async (u) => (await notifs(u.id, { kind: 'comment_reply' })).length;
  const base = { owner: await count(owner), editor: await count(editor), viewer: await count(viewer), admin: await count(admin) };
  await req('POST', `/threads/${tid}/comments`, { body: { body: `Viewer replies, cc {{@${editor.id}}}` }, token: viewer.token, ws: WS });
  await sleep(250);
  check('thread author (owner) gets comment_reply', (await count(owner)) === base.owner + 1);
  check('mentioned participant gets the mention, not a second reply notification', (await count(editor)) === base.editor);
  check('the replier gets nothing', (await count(viewer)) === base.viewer);
  check('non-participants get nothing', (await count(admin)) === base.admin);
}

// ---------------------------------------------------------------- F. anchors follow the graph
console.log('\nF. deleting a node detaches its threads; undo re-attaches');
{
  const del = await cOwner.op(WF, { type: 'node.delete', nodeId: 'a1' });
  check('collab node.delete accepted', del?.ok === true, JSON.stringify(del));
  const detached = await waitFor(async () => (await threadDoc(T1))?.anchor?.detached === true);
  check('thread on a1 is now detached (still exists)', detached);
  const anchorEvt = await cEditor.wait((e, p) => e === 'comment:anchor' && p?.threadId === T1 && p?.anchor?.detached === true);
  check('comment:anchor broadcast on detach', Boolean(anchorEvt));
  const listed = (await req('GET', `/workflows/${WF}/threads`, { token: editor.token, ws: WS })).body.find((x) => x.id === T1);
  check('detached thread is still listed, keeping the last known position', listed?.anchor?.detached === true && Number.isFinite(listed.anchor.x));
  const back = await cOwner.op(WF, { type: 'node.add', node: N('a1', 'agent', { systemPrompt: 'hi' }, 200) });
  check('undo: node.add with the same id accepted', back?.ok === true, JSON.stringify(back));
  const reattached = await waitFor(async () => (await threadDoc(T1))?.anchor?.detached === false);
  check('thread re-attaches automatically', reattached);
  const put = await req('PUT', `/workflows/${WF}`, { body: { nodes: graph().nodes.filter((n) => n.id !== 'a1'), edges: [] }, token: owner.token, ws: WS });
  check('a whole-document PUT without the node -> 200', put.status === 200, `${put.status}`);
  check('...detaches too', await waitFor(async () => (await threadDoc(T1))?.anchor?.detached === true));
  const repin = await req('PATCH', `/threads/${T1}`, { body: { anchor: { type: 'canvas', x: 42, y: 7 } }, token: editor.token, ws: WS });
  check('a detached thread can be re-pinned to the canvas', repin.status === 200 && repin.body?.anchor?.type === 'canvas' && !repin.body.anchor.detached);
  await req('PUT', `/workflows/${WF}`, { body: graph(), token: owner.token, ws: WS });
}

// ---------------------------------------------------------------- G. bell across workspaces
console.log('\nG. the bell spans workspaces, shows only your own, and syncs read state across tabs');
{
  // editor's personal workspace, with the owner as a member there
  await joinExisting(editor, editor.ws, owner, 'editor');
  const wfB = await makeWorkflow(editor, editor.ws, 'Personal flow');
  await req('POST', `/workflows/${wfB}/threads`, { body: { anchor: { type: 'canvas', x: 1, y: 1 }, body: `ping {{@${editor.id}}}` }, token: owner.token, ws: editor.ws });
  // ...editor mentioning themselves creates nothing, so have the owner mention them in B
  const mine = await listNotifs(editor);
  const workspaces = new Set((mine.body?.items || []).map((n) => n.workspaceId));
  check('editor sees notifications from both workspaces in one list', workspaces.has(WS) && workspaces.has(editor.ws), JSON.stringify([...workspaces]));
  check('each row names its workspace', (mine.body?.items || []).every((n) => n.kind === 'invite' || n.workspace?.name));
  const theirs = await listNotifs(owner);
  const editorIds = new Set((mine.body?.items || []).map((n) => n.id));
  check("owner's list never contains the editor's notifications", !(theirs.body?.items || []).some((n) => editorIds.has(n.id)));
  const one = mine.body.items.find((n) => !n.readAt);
  const foreign = await req('POST', `/notifications/${one.id}/read`, { token: owner.token });
  check("marking someone else's notification -> 404", foreign.status === 404);
  const unreadBefore = mine.body.unreadCount;
  const mr = await req('POST', `/notifications/${one.id}/read`, { token: editor.token });
  check('mark read -> 204', mr.status === 204);
  const tab2 = await cEditor2.wait((e, p) => e === 'notification:read' && Array.isArray(p?.ids) && p.ids.includes(one.id));
  check("the other tab's bell updates live (notification:read with unreadCount)", tab2?.unreadCount === unreadBefore - 1, JSON.stringify(tab2));
  const unreadOnly = await listNotifs(editor, '?unread=true');
  check('?unread=true excludes read rows', !(unreadOnly.body?.items || []).some((n) => n.id === one.id));
  const page = await listNotifs(editor, '?limit=1');
  const page2 = page.body?.nextCursor ? await listNotifs(editor, `?limit=1&before=${page.body.nextCursor}`) : null;
  check('cursor pagination returns the next, different row', page.body?.items?.length === 1 && page2?.body?.items?.length === 1 && page2.body.items[0].id !== page.body.items[0].id);
  const all = await req('POST', '/notifications/read-all', { token: editor.token });
  const tabAll = await cEditor2.wait((e, p) => e === 'notification:read' && p?.ids === 'all');
  check('read-all -> 204, unreadCount 0 pushed to other tabs', all.status === 204 && tabAll?.unreadCount === 0);
}

// ---------------------------------------------------------------- H. run_failed + collapse
console.log('\nH. failed runs notify watchers, collapsed per workflow');
{
  const failing = { nodes: [N('s', 'start'), N('t', 'tool', { integration: 'builtin', action: 'fake-weather', params: { city: 'X' }, mockOverrides: { failureRate: 1, maxAttempts: 1, latencyMs: [5, 10] } }, 200), N('e', 'end', {}, 400)], edges: [{ id: 'e1', source: 's', target: 't' }, { id: 'e2', source: 't', target: 'e' }] };
  const wf = await makeWorkflow(owner, WS, `Flaky ${uniq()}`, failing);
  const w0 = await req('GET', `/workflows/${wf}/watch`, { token: owner.token, ws: WS });
  check('creator watches implicitly', w0.body?.watching === true);
  const wv = await req('GET', `/workflows/${wf}/watch`, { token: viewer.token, ws: WS });
  check('others do not by default', wv.body?.watching === false);
  const put = await req('PUT', `/workflows/${wf}/watch`, { token: editor.token, ws: WS });
  check('editor watches -> 204', put.status === 204 && (await req('GET', `/workflows/${wf}/watch`, { token: editor.token, ws: WS })).body?.watching === true);
  const runOnce = async () => {
    const r = await req('POST', `/workflows/${wf}/runs`, { token: owner.token, ws: WS });
    await waitFor(async () => {
      const run = await req('GET', `/runs/${r.body?.runId}`, { token: owner.token, ws: WS });
      return ['failed', 'success', 'cancelled'].includes(run.body?.status) ? run.body : null;
    }, 8000);
    await sleep(300);
    return r.body?.runId;
  };
  const key = `run_failed:${wf}`;
  const runIds = [];
  for (let i = 0; i < 3; i++) runIds.push(await runOnce());
  const ownerRows = await notifs(owner.id, { groupKey: key });
  const editorRows = await notifs(editor.id, { groupKey: key });
  check('three failures collapse into ONE unread row for the creator, count 3', ownerRows.length === 1 && ownerRows[0].count === 3 && !ownerRows[0].readAt, JSON.stringify(ownerRows.map((r) => r.count)));
  check('...and for the explicit watcher', editorRows.length === 1 && editorRows[0].count === 3);
  check('the collapsed row points at the newest failed run', ownerRows[0].link === `/w/${SLUG}/runs/${runIds[2]}`, ownerRows[0].link);
  check('non-watchers get nothing', (await notifs(viewer.id, { groupKey: key })).length === 0);
  await req('DELETE', `/workflows/${wf}/watch`, { token: editor.token, ws: WS });
  await req('DELETE', `/workflows/${wf}/watch`, { token: owner.token, ws: WS });
  check('the creator can unwatch too', (await req('GET', `/workflows/${wf}/watch`, { token: owner.token, ws: WS })).body?.watching === false);
  await runOnce();
  check('after unwatching, a new failure notifies nobody', (await notifs(editor.id, { groupKey: key }))[0]?.count === 3 && (await notifs(owner.id, { groupKey: key }))[0]?.count === 3);
  // Once read, the next failure starts a fresh row rather than resurrecting the old one.
  await req('PUT', `/workflows/${wf}/watch`, { token: editor.token, ws: WS });
  await req('POST', `/notifications/${editorRows[0]._id}/read`, { token: editor.token });
  await runOnce();
  const afterRead = await notifs(editor.id, { groupKey: key });
  check('a failure after reading opens a new unread row', afterRead.length === 2 && afterRead.some((r) => !r.readAt && r.count === 1));
  const c = await req('POST', `/workflows/${WF}/threads`, { body: { anchor: { type: 'canvas', x: 3, y: 3 }, body: 'first comment' }, token: admin.token, ws: WS });
  check('commenting auto-watches the commenter', c.status === 201 && (await req('GET', `/workflows/${WF}/watch`, { token: admin.token, ws: WS })).body?.watching === true);
}

// ---------------------------------------------------------------- I. invites + role changes
console.log('\nI. invite and role-change notifications');
{
  const existing = await register('Iris');
  const inv = await invite(owner, WS, existing.email, 'viewer');
  check('invite an existing user -> created', ok2xx(inv.status));
  const out = await req('GET', '/outbox', { token: existing.token });
  check('...an Outbox message arrives', (out.body || []).some((m) => m.kind === 'invite'));
  const bell = await listNotifs(existing);
  const n = (bell.body?.items || []).find((x) => x.kind === 'invite');
  check('...and an invite notification, although not a member yet', Boolean(n) && n.link.startsWith('/invite/'), JSON.stringify(n));
  const freshEmail = newEmail('nobody');
  const inv2 = await invite(owner, WS, freshEmail, 'viewer');
  check('invite a brand-new email -> Outbox only (nobody to notify)', ok2xx(inv2.status) && (await db.collection('outboxmessages').countDocuments({ to: freshEmail })) === 1);
  const demote = await req('PATCH', `/workspaces/${WS}/members/${admin.id}`, { body: { role: 'editor' }, token: owner.token });
  check('role change -> 200', demote.status === 200);
  const rc = await waitFor(async () => (await notifs(admin.id, { kind: 'role_changed' }))[0]);
  check('the affected member gets role_changed', Boolean(rc) && /an editor/.test(rc.title) && rc.link === `/w/${SLUG}/dashboard`, rc?.title);
  check("the actor doesn't", (await notifs(owner.id, { kind: 'role_changed' })).length === 0);
}

// ---------------------------------------------------------------- J. share payload + isolation
console.log('\nJ. share links carry no comments; other workspaces get 404');
{
  // Share links show the published version (spec/30), so publish first.
  await req('POST', `/workflows/${WF}/publish`, { body: { message: 'for sharing', acknowledgeWarnings: true }, token: owner.token, ws: WS });
  const sh = await req('POST', `/workflows/${WF}/share`, { token: owner.token, ws: WS });
  const pub = await req('GET', `/shared/${sh.body?.shareToken}`);
  const leak = pub.text.match(/Is this prompt right|Looks fine to me|"threads?"|"comments?"/i);
  check('shared payload contains no threads or comment text', pub.status === 200 && !leak, `${pub.status} ${leak?.[0] || ''}`);
  const oWs = outsider.ws;
  const list = await req('GET', `/workflows/${WF}/threads`, { token: outsider.token, ws: oWs });
  check("another workspace can't list the threads (404)", list.status === 404);
  const rep = await req('POST', `/threads/${T1}/comments`, { body: { body: 'sneaky' }, token: outsider.token, ws: oWs });
  check("...can't reply to a foreign thread (404)", rep.status === 404);
  const t = (await req('GET', `/workflows/${WF}/threads`, { token: owner.token, ws: WS })).body.find((x) => x.id === T1);
  const cid = t?.comments?.[0]?.id;
  check("...can't edit a foreign comment (404)", (await req('PATCH', `/comments/${cid}`, { body: { body: 'x' }, token: outsider.token, ws: oWs })).status === 404);
  check("...can't delete a foreign comment (404)", (await req('DELETE', `/comments/${cid}`, { token: outsider.token, ws: oWs })).status === 404);
  check("...can't resolve a foreign thread (404)", (await req('POST', `/threads/${T1}/resolve`, { token: outsider.token, ws: oWs })).status === 404);
  check("...can't watch a foreign workflow (404)", (await req('PUT', `/workflows/${WF}/watch`, { token: outsider.token, ws: oWs })).status === 404);
  check('malformed thread id -> 404, not 500', (await req('POST', '/threads/not-an-id/comments', { body: { body: 'x' }, token: owner.token, ws: WS })).status === 404);
  const outsiderRoom = client(outsider);
  await outsiderRoom.ready;
  const ack = await outsiderRoom.emit('workflow:subscribe', { workflowId: WF });
  await req('POST', `/threads/${T1}/comments`, { body: { body: 'members only' }, token: owner.token, ws: WS });
  await sleep(300);
  check('an outsider socket cannot join the room and receives no comment events', ack?.ok === false && outsiderRoom.of('comment:created').length === 0);
  outsiderRoom.socket.close();
}

// ---------------------------------------------------------------- K. leaving hides that workspace
console.log("\nK. leaving a workspace hides its notifications (they return on rejoin)");
{
  const u = await join(owner, WS, 'viewer', 'Leo');
  await req('POST', `/workflows/${WF}/threads`, { body: { anchor: { type: 'canvas', x: 9, y: 9 }, body: `for {{@${u.id}}}` }, token: owner.token, ws: WS });
  await sleep(200);
  const before = await listNotifs(u);
  check('mention visible while a member', (before.body?.items || []).some((n) => n.kind === 'mention' && n.workspaceId === WS));
  await req('DELETE', `/workspaces/${WS}/members/${u.id}`, { token: owner.token });
  const after = await listNotifs(u);
  check('hidden after removal, and not counted', !(after.body?.items || []).some((n) => n.workspaceId === WS) && after.body?.unreadCount === 0);
  check('...but not deleted', (await notifs(u.id, { workspaceId: oid(WS) })).length >= 1);
}

for (const c of [cOwner, cEditor, cEditor2]) c.socket.close();
await mongoose.disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
