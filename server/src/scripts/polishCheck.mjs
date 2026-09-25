/**
 * Polish check for spec/36 part 2 (and the spec/27 + spec/33 leftovers that
 * landed with it) - profile, password change and session revocation, template
 * edit/delete, the onboarding checklist, the sandbox data API, and seats.
 * Needs a running server (with `npm run seed:templates` done) and its database:
 *
 *   BASE=http://localhost:4500/api MONGODB_URI=... npm run check:polish
 */
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { io } from 'socket.io-client';
import { env } from '../config/env.js';
import SandboxRecord from '../models/SandboxRecord.js';

const B = process.env.BASE || 'http://localhost:4500/api';
const SOCKET_URL = B.replace(/\/api\/?$/, '');
const DB_URI = process.env.MONGODB_URI;
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`); ok ? pass++ : fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const newEmail = (tag) => `${tag}${uniq()}@polish.dev`;
async function register(tag, email = newEmail(tag), password = 'password123') {
  const r = await req('POST', '/auth/register', { body: { email, password, name: tag } });
  return { token: r.body?.token, user: r.body?.user, email, password, ws: r.body?.workspaces?.[0]?.id };
}
async function login(email, password) {
  const r = await req('POST', '/auth/login', { body: { email, password } });
  return r.body?.token;
}
const meStatus = async (token) => (await req('GET', '/auth/me', { token })).status;

function socketOk(token) {
  const socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((resolve) => {
    const done = (r) => { socket.close(); resolve(r); };
    socket.once('connect', () => done({ ok: true }));
    socket.once('connect_error', (err) => done({ ok: false, message: err?.message }));
    setTimeout(() => done({ ok: false, message: 'timeout' }), 4000);
  });
}

const N = (id, type, config) => ({ id, type, position: { x: 0, y: 0 }, data: { config } });
const quickGraph = { nodes: [N('s', 'start', { label: 'Start' }), N('e', 'end', { label: 'End' })], edges: [{ id: 'e1', source: 's', target: 'e' }] };
async function makeWorkflow(u, ws, name) {
  const r = await req('POST', '/workflows', { body: { name }, token: u.token, ws });
  await req('PUT', `/workflows/${r.body?._id}`, { body: quickGraph, token: u.token, ws });
  return r.body?._id;
}
async function join(owner, ws, role, tag = role) {
  const email = newEmail(tag);
  const inv = await req('POST', `/workspaces/${ws}/invitations`, { body: { email, role }, token: owner.token });
  const u = await register(tag, email);
  await req('POST', `/invitations/${String(inv.body?.inviteUrl || '').split('/invite/').pop()}/accept`, { token: u.token });
  return u;
}

await mongoose.connect(DB_URI);

// ------------------------------------------------------------ A: password change
console.log('A. password change signs out every other session (REST + socket)');
{
  const u = await register('pat');
  const other = await login(u.email, u.password);
  check('two sessions both work before the change', (await meStatus(u.token)) === 200 && (await meStatus(other)) === 200);
  check('the other session can open a socket', (await socketOk(other)).ok);

  const wrong = await req('POST', '/auth/password', { token: u.token, body: { currentPassword: 'nope', newPassword: 'newpassword1' } });
  check('wrong current password -> 400', wrong.status === 400, `${wrong.status} ${wrong.body?.error}`);
  check('... and nothing was revoked', (await meStatus(other)) === 200);
  const short = await req('POST', '/auth/password', { token: u.token, body: { currentPassword: u.password, newPassword: '123' } });
  check('too-short new password -> 400', short.status === 400);

  const changed = await req('POST', '/auth/password', { token: u.token, body: { currentPassword: u.password, newPassword: 'newpassword1' } });
  const fresh = changed.body?.token;
  check('password change returns a fresh token', changed.status === 200 && typeof fresh === 'string' && fresh !== u.token, `${changed.status}`);
  check('the fresh token works', (await meStatus(fresh)) === 200);
  check('the other session is now rejected (401)', (await meStatus(other)) === 401);
  check("the caller's old token is rejected too (401)", (await meStatus(u.token)) === 401);
  const sock = await socketOk(other);
  check('the other session can no longer connect a socket', !sock.ok && sock.message === 'unauthorized', JSON.stringify(sock));
  check('the fresh token can connect a socket', (await socketOk(fresh)).ok);
  check('login with the old password fails', !(await login(u.email, u.password)));
  check('login with the new password works', Boolean(await login(u.email, 'newpassword1')));
}

// --------------------------------------------------------- B: revoke other sessions
console.log('\nB. "sign out everywhere else" and pre-tokenVersion tokens');
{
  const u = await register('rev');
  const other = await login(u.email, u.password);
  const r = await req('POST', '/auth/sessions/revoke', { token: u.token });
  check('revoke returns a fresh token for this session', r.status === 200 && (await meStatus(r.body?.token)) === 200, `${r.status}`);
  check('other session revoked', (await meStatus(other)) === 401);
  const r2 = await req('POST', '/auth/logout-all', { token: r.body?.token });
  check('logout-all alias also rotates', r2.status === 200 && (await meStatus(r.body?.token)) === 401 && (await meStatus(r2.body?.token)) === 200);

  const legacyUser = await register('legacy');
  const legacyToken = jwt.sign({ sub: legacyUser.user.id }, env.jwtSecret, { expiresIn: '1h' });
  check('a token with no tokenVersion claim still works (treated as v0)', (await meStatus(legacyToken)) === 200);
  await req('POST', '/auth/sessions/revoke', { token: legacyUser.token });
  check('... until the first revoke', (await meStatus(legacyToken)) === 401);
}

// ------------------------------------------------------------------ C: profile
console.log('\nC. profile rename');
{
  const u = await register('ren');
  const r = await req('PATCH', '/auth/me', { token: u.token, body: { name: '  Renata Renamed ' } });
  check('PATCH /auth/me trims and saves the name', r.status === 200 && r.body?.name === 'Renata Renamed', `${r.status} ${r.body?.name}`);
  const me = await req('GET', '/auth/me', { token: u.token });
  check('/auth/me reflects it', me.body?.name === 'Renata Renamed');
  const members = await req('GET', `/workspaces/${u.ws}/members`, { token: u.token });
  check('member list reflects it', (members.body || []).some((m) => m.userId === u.user.id && m.name === 'Renata Renamed'));
  const empty = await req('PATCH', '/auth/me', { token: u.token, body: { name: '   ' } });
  check('an empty name is rejected (400)', empty.status === 400);
}

// ---------------------------------------------------------------- D: templates
console.log('\nD. template edit and delete');
{
  const owner = await register('tpl');
  const outsider = await register('tplout');
  const viewer = await join(owner, owner.ws, 'viewer', 'tplview');
  const wf = await makeWorkflow(owner, owner.ws, 'template source');
  const created = await req('POST', '/templates', { token: owner.token, ws: owner.ws, body: { workflowId: wf, name: 'Mine', description: 'first' } });
  const id = created.body?._id;
  check('workspace template created', created.status === 201 && id, `${created.status}`);

  const list = await req('GET', '/templates', { token: owner.token, ws: owner.ws });
  const row = (list.body || []).find((t) => t._id === id);
  check('list shows the creator\'s name', row?.createdByName === 'tpl', JSON.stringify(row?.createdByName));
  const builtIn = (list.body || []).find((t) => t.builtIn);

  const patched = await req('PATCH', `/templates/${id}`, { token: owner.token, ws: owner.ws, body: { name: ' Renamed ', description: 'second' } });
  check('PATCH renames and re-describes', patched.status === 200 && patched.body?.name === 'Renamed' && patched.body?.description === 'second', `${patched.status}`);
  const blank = await req('PATCH', `/templates/${id}`, { token: owner.token, ws: owner.ws, body: { name: '' } });
  check('blank name -> 400', blank.status === 400);
  if (builtIn) {
    const pb = await req('PATCH', `/templates/${builtIn._id}`, { token: owner.token, ws: owner.ws, body: { name: 'hijack' } });
    const db = await req('DELETE', `/templates/${builtIn._id}`, { token: owner.token, ws: owner.ws });
    check('built-in PATCH -> 403', pb.status === 403, `${pb.status}`);
    check('built-in DELETE -> 403', db.status === 403, `${db.status}`);
  } else {
    check('built-in templates seeded (run seed:templates)', false);
  }
  const foreign = await req('PATCH', `/templates/${id}`, { token: outsider.token, ws: outsider.ws, body: { name: 'x' } });
  check("another workspace can't see it (404)", foreign.status === 404, `${foreign.status}`);
  const vp = await req('PATCH', `/templates/${id}`, { token: viewer.token, ws: owner.ws, body: { name: 'x' } });
  const vd = await req('DELETE', `/templates/${id}`, { token: viewer.token, ws: owner.ws });
  check('viewer PATCH/DELETE -> 403', vp.status === 403 && vd.status === 403, `${vp.status}/${vd.status}`);

  const used = await req('POST', `/templates/${id}/use`, { token: owner.token, ws: owner.ws, body: { workflowName: 'from template' } });
  const del = await req('DELETE', `/templates/${id}`, { token: owner.token, ws: owner.ws });
  check('DELETE -> 204', del.status === 204, `${del.status}`);
  const after = await req('GET', '/templates', { token: owner.token, ws: owner.ws });
  check('deleted template is gone from the gallery', !(after.body || []).some((t) => t._id === id));
  const copy = await req('GET', `/workflows/${used.body?._id}`, { token: owner.token, ws: owner.ws });
  check('a workflow created from it is unaffected', copy.status === 200 && copy.body?.nodes?.length === 2);
  const again = await req('POST', `/templates/${id}/use`, { token: owner.token, ws: owner.ws, body: {} });
  check('using the deleted template -> 404', again.status === 404);
  const audited = await mongoose.connection.db.collection('auditevents').findOne({ workspaceId: new mongoose.Types.ObjectId(owner.ws), action: 'template.deleted' });
  check('template.deleted was audited', Boolean(audited));
}

// --------------------------------------------------------------- E: onboarding
console.log('\nE. onboarding checklist is derived from real data');
{
  const owner = await register('onb');
  const ws = owner.ws;
  const steps = async (u = owner) => {
    const r = await req('GET', `/workspaces/${ws}/onboarding`, { token: u.token });
    return { status: r.status, body: r.body, done: Object.fromEntries((r.body?.steps || []).map((s) => [s.key, s.done])) };
  };
  let s = await steps();
  check('six steps, none done in a fresh workspace', s.status === 200 && s.body?.steps?.length === 6 && Object.values(s.done).every((d) => !d), JSON.stringify(s.done));
  check('not dismissed, not complete', s.body?.dismissed === false && s.body?.complete === false);

  const wf = await makeWorkflow(owner, ws, 'onboarding');
  s = await steps();
  check('creating a workflow ticks create_workflow', s.done.create_workflow === true && s.done.run_workflow === false);
  await req('POST', `/workflows/${wf}/runs`, { token: owner.token, ws, body: {} });
  s = await steps();
  check('running it ticks run_workflow', s.done.run_workflow === true);
  const pub = await req('POST', `/workflows/${wf}/publish`, { token: owner.token, ws, body: { acknowledgeWarnings: true } });
  s = await steps();
  check('publishing ticks publish_version', pub.status === 201 && s.done.publish_version === true, `${pub.status}`);
  await req('PUT', `/workflows/${wf}/schedule`, { token: owner.token, ws, body: { cronExpression: '0 9 * * 1', enabled: true } });
  s = await steps();
  check('an enabled schedule ticks set_up_trigger', s.done.set_up_trigger === true);
  let conn = await req('POST', '/connections', { token: owner.token, ws, body: { integration: 'http', name: 'Onboard HTTP', mode: 'sandbox', credentials: {}, config: {} } });
  if (conn.status !== 201) {
    conn = await req('POST', '/connections', { token: owner.token, ws, body: { integration: 'github', name: 'Onboard GH', mode: 'sandbox', credentials: { token: 'ghp_placeholder_placeholder' }, config: {} } });
  }
  s = await steps();
  check('adding a connection ticks add_connection', conn.status === 201 && s.done.add_connection === true, `${conn.status} ${conn.body?.error || ''}`);
  const viewer = await join(owner, ws, 'viewer', 'onbview');
  s = await steps();
  check('a teammate ticks invite_teammate', s.done.invite_teammate === true);
  check('all six done -> complete', s.body?.complete === true);

  const vs = await steps(viewer);
  check("a viewer sees the steps it can't do as canDo:false", vs.status === 200 && vs.body.steps.find((x) => x.key === 'invite_teammate')?.canDo === false && vs.body.steps.find((x) => x.key === 'add_connection')?.canDo === false);
  const dis = await req('POST', `/workspaces/${ws}/onboarding/dismiss`, { token: viewer.token });
  check('dismiss -> 204', dis.status === 204, `${dis.status}`);
  check('dismissal persists for that member', (await steps(viewer)).body?.dismissed === true);
  check("... and doesn't hide it for anyone else", (await steps()).body?.dismissed === false);
  await req('PATCH', `/workspaces/${ws}/onboarding`, { token: viewer.token, body: { dismissed: false } });
  check('PATCH { dismissed: false } undoes it', (await steps(viewer)).body?.dismissed === false);
  const outsider = await register('onbout');
  const foreign = await req('GET', `/workspaces/${ws}/onboarding`, { token: outsider.token });
  check('a non-member gets 404', foreign.status === 404, `${foreign.status}`);
}

// ------------------------------------------------------------------ F: sandbox
console.log('\nF. sandbox data API (per workspace)');
{
  const a = await register('sba');
  const b = await register('sbb');
  const viewer = await join(a, a.ws, 'viewer', 'sbview');
  await SandboxRecord.create([
    { workspaceId: a.ws, integration: 'github', collectionName: 'github.issues', doc: { number: 1, title: 'Hello' } },
    { workspaceId: a.ws, integration: 'github', collectionName: 'github.issues', doc: { number: 2, title: 'World' } },
    { workspaceId: a.ws, integration: 'github', collectionName: 'github._seeded', doc: { key: 'marker' } },
  ]);
  const got = await req('GET', '/integrations/github/sandbox', { token: a.token, ws: a.ws });
  const issues = (got.body?.collections || []).find((c) => c.name === 'issues');
  check("lists this workspace's collections with counts", got.status === 200 && issues?.count === 2, JSON.stringify(got.body?.collections));
  check('internal marker collections stay hidden', !(got.body?.collections || []).some((c) => c.name.startsWith('_')) && !(got.body?.records || []).some((r) => r.collection.startsWith('_')));
  check('recent records carry collection + doc', (got.body?.records || []).length === 2 && got.body.records.every((r) => r.collection === 'issues' && r.doc?.title));
  const other = await req('GET', '/integrations/github/sandbox', { token: b.token, ws: b.ws });
  check('another workspace sees none of it', other.status === 200 && (other.body?.collections || []).length === 0 && (other.body?.records || []).length === 0);
  const unknown = await req('GET', '/integrations/not-a-thing/sandbox', { token: a.token, ws: a.ws });
  check('unknown integration -> 404', unknown.status === 404);
  const vr = await req('POST', '/integrations/github/sandbox/reset', { token: viewer.token, ws: a.ws });
  check('viewer reset -> 403', vr.status === 403, `${vr.status}`);
  const reset = await req('POST', '/integrations/github/sandbox/reset', { token: a.token, ws: a.ws });
  check('owner reset removes everything incl. markers', reset.status === 200 && reset.body?.deleted === 3, JSON.stringify(reset.body));
  const empty = await req('GET', '/integrations/github/sandbox', { token: a.token, ws: a.ws });
  check('... and the tab is empty afterwards', (empty.body?.collections || []).length === 0);
  await SandboxRecord.create({ workspaceId: b.ws, integration: 'github', collectionName: 'github.issues', doc: { number: 9 } });
  await req('POST', '/integrations/github/sandbox/reset', { token: a.token, ws: a.ws });
  check("resetting one workspace never touches another's", (await SandboxRecord.countDocuments({ workspaceId: b.ws })) === 1);
}

// -------------------------------------------------------------------- G: seats
console.log('\nG. seats vs the plan member limit');
{
  const owner = await register('seat');
  let s = await req('GET', `/workspaces/${owner.ws}/members/seats`, { token: owner.token });
  check('fresh Free workspace: 1 of 5 seats', s.status === 200 && s.body?.seatsUsed === 1 && s.body?.seatLimit === 5 && s.body?.atLimit === false, JSON.stringify(s.body));
  for (let i = 0; i < 4; i++) {
    await req('POST', `/workspaces/${owner.ws}/invitations`, { token: owner.token, body: { email: newEmail(`seat${i}`), role: 'viewer' } });
  }
  s = await req('GET', `/workspaces/${owner.ws}/members/seats`, { token: owner.token });
  check('pending invites count: 5 of 5, atLimit', s.body?.seatsUsed === 5 && s.body?.atLimit === true, JSON.stringify(s.body));
  const blocked = await req('POST', `/workspaces/${owner.ws}/invitations`, { token: owner.token, body: { email: newEmail('seatx'), role: 'viewer' } });
  check('... and the server agrees (403 on a new invite)', blocked.status === 403, `${blocked.status}`);
  await req('PATCH', `/workspaces/${owner.ws}/plan`, { token: owner.token, body: { plan: 'team' } });
  s = await req('GET', `/workspaces/${owner.ws}/members/seats`, { token: owner.token });
  check('Team plan lifts the limit to 25', s.body?.seatLimit === 25 && s.body?.atLimit === false, JSON.stringify(s.body));
}

await mongoose.disconnect();
await sleep(50);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
