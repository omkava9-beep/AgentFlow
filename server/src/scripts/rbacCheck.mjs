/**
 * RBAC check for spec/23 - roles, the permission matrix, invitations, the Outbox,
 * members management and the workspace-wide sharing switch, as a runnable script.
 * Needs a running server (with `npm run seed:templates` done) and its database:
 *
 *   PORT=4500 MONGODB_URI=...-check npm run dev                      # terminal 1
 *   BASE=http://localhost:4500/api MONGODB_URI=... npm run check:rbac # terminal 2
 *
 * The matrix section is exhaustive: it imports the server's own PERMISSIONS table
 * and, for every role, calls one or more real endpoints per action and expects
 * success exactly when `can(role, action)` says so. A row added to the table
 * without a probe here is reported, so the two can't silently drift apart.
 */
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { PERMISSIONS, ROLES, can, permissionsFor } from '../tenancy/permissions.js';

const B = process.env.BASE || 'http://localhost:4500/api';
const DB_URI = process.env.MONGODB_URI;
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`); ok ? pass++ : fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok2xx = (s) => s >= 200 && s < 300;

if (!DB_URI) {
  console.error('MONGODB_URI must be set to the running server\'s database');
  process.exit(1);
}

/** `ws` is sent as X-Workspace-Id; omit it for /auth, /workspaces and public routes. */
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
const newEmail = (tag) => `${tag}${uniq()}@rbac.dev`;
async function register(tag, email = newEmail(tag)) {
  const r = await req('POST', '/auth/register', { body: { email, password: 'password123', name: tag } });
  return { token: r.body?.token, user: r.body?.user, email, personal: r.body?.workspaces?.[0]?.id };
}
const tokenFromUrl = (url) => String(url || '').split('/invite/').pop();

async function invite(owner, ws, email, role) {
  const r = await req('POST', `/workspaces/${ws}/invitations`, { body: { email, role }, token: owner.token });
  return { ...r, token: tokenFromUrl(r.body?.inviteUrl), invId: r.body?.invitation?.id || r.body?.invitation?._id };
}
/** Owner invites a brand-new user with `role`; the user registers and accepts. */
async function join(owner, ws, role, tag = role) {
  const email = newEmail(tag);
  const inv = await invite(owner, ws, email, role);
  const u = await register(tag, email);
  const acc = await req('POST', `/invitations/${inv.token}/accept`, { token: u.token });
  return { ...u, acceptStatus: acc.status, acceptBody: acc.body };
}

const N = (id, type, config) => ({ id, type, position: { x: 0, y: 0 }, data: { config } });
const quickGraph = { nodes: [N('s', 'start', { label: 'Start' }), N('e', 'end', { label: 'End' })], edges: [{ id: 'e1', source: 's', target: 'e' }] };
const slowGraph = (ms) => ({
  nodes: [
    N('s', 'start', { label: 'Start' }),
    N('t', 'tool', { label: 'Slow', toolType: 'calculator', toolConfig: { expression: `1+${uniq()}` }, mockOverrides: { failureRate: 0, latencyMs: [ms, ms + 50] } }),
    N('e', 'end', { label: 'End' }),
  ],
  edges: [{ id: 'e1', source: 's', target: 't' }, { id: 'e2', source: 't', target: 'e' }],
});
async function makeWorkflow(u, ws, name, graph = quickGraph) {
  const r = await req('POST', '/workflows', { body: { name }, token: u.token, ws });
  await req('PUT', `/workflows/${r.body?._id}`, { body: graph, token: u.token, ws });
  // spec/30: triggers and share links use the PUBLISHED version, so fixtures
  // are published the way a user would press Publish after building them.
  await req('POST', `/workflows/${r.body?._id}/publish`, { body: { acknowledgeWarnings: true }, token: u.token, ws });
  return r.body?._id;
}
async function waitRun(u, ws, runId, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const r = await req('GET', `/runs/${runId}`, { token: u.token, ws });
    if (['success', 'failed', 'cancelled'].includes(r.body?.status)) return r.body;
    await sleep(150);
  }
  return null;
}

await mongoose.connect(DB_URI);
const db = mongoose.connection.db;
const members = (ws) => db.collection('memberships').find({ workspaceId: new mongoose.Types.ObjectId(ws) }).toArray();

// ------------------------------------------------------------------ setup
const owner = await register('owner');
const wsRes = await req('POST', '/workspaces', { body: { name: `RBAC Team ${uniq()}` }, token: owner.token });
const WS = wsRes.body?.id;
const SLUG = wsRes.body?.slug;
const U = { owner };
// Enterprise: the probes below add far more members than Free's 5 seats allow
// (spec/33's member limit), and seat limits aren't what this script tests.
await req('PATCH', `/workspaces/${WS}/plan`, { body: { plan: 'enterprise' }, token: owner.token });
for (const role of ['admin', 'editor', 'viewer']) U[role] = await join(owner, WS, role);

console.log('A. every role receives exactly permissionsFor(role)');
{
  check('owner created a team workspace', wsRes.status === 201 && WS && wsRes.body.role === 'owner', `${wsRes.status}`);
  for (const role of ['admin', 'editor', 'viewer']) {
    check(`${role} accepted the invite with role ${role}`, U[role].acceptStatus === 200 && U[role].acceptBody?.workspace?.role === role,
      `${U[role].acceptStatus} ${JSON.stringify(U[role].acceptBody)}`);
  }
  for (const role of ROLES) {
    const list = await req('GET', '/workspaces', { token: U[role].token });
    const ws = (list.body || []).find((w) => w.id === WS);
    const expected = permissionsFor(role);
    check(`${role}: GET /workspaces permissions match the matrix (${expected.length})`,
      ws && JSON.stringify([...(ws.permissions || [])].sort()) === JSON.stringify(expected), JSON.stringify(ws?.permissions));
    const bySlug = await req('GET', `/workspaces/by-slug/${SLUG}`, { token: U[role].token });
    check(`${role}: by-slug role + permissions`, bySlug.body?.role === role
      && JSON.stringify([...(bySlug.body?.permissions || [])].sort()) === JSON.stringify(expected));
  }
  const acceptPerms = U.viewer.acceptBody?.workspace?.permissions || [];
  check('accept response carries permissions too', JSON.stringify([...acceptPerms].sort()) === JSON.stringify(permissionsFor('viewer')));
}

// ------------------------------------------------------------------ matrix
console.log('\nB. exhaustive permission matrix (each action, each role, real endpoints)');
const builtIn = ((await req('GET', '/templates', { token: owner.token, ws: WS })).body || []).find((t) => t.builtIn);
const sharedWf = await makeWorkflow(owner, WS, 'matrix fixture');
const sharedRun = (await req('POST', `/workflows/${sharedWf}/runs`, { token: owner.token, ws: WS })).body?.runId;
await waitRun(owner, WS, sharedRun);

/**
 * Each probe gets fresh fixtures (created by the owner) so an allowed call by one
 * role can't change what the next role sees. Returns the HTTP status.
 */
const PROBES = {
  'workflow:read': [
    ['GET /workflows', (u) => req('GET', '/workflows', { token: u.token, ws: WS })],
    ['GET /workflows/:id', (u) => req('GET', `/workflows/${sharedWf}`, { token: u.token, ws: WS })],
    ['GET /workflows/:id/runs', (u) => req('GET', `/workflows/${sharedWf}/runs`, { token: u.token, ws: WS })],
    ['GET /runs/:id', (u) => req('GET', `/runs/${sharedRun}`, { token: u.token, ws: WS })],
    ['GET /analytics/summary', (u) => req('GET', '/analytics/summary', { token: u.token, ws: WS })],
    ['GET /templates', (u) => req('GET', '/templates', { token: u.token, ws: WS })],
  ],
  'workflow:edit': [
    ['POST /workflows', (u) => req('POST', '/workflows', { body: { name: 'by role' }, token: u.token, ws: WS })],
    ['PUT /workflows/:id', async (u) => req('PUT', `/workflows/${await makeWorkflow(owner, WS, 'edit me')}`, { body: { name: 'renamed' }, token: u.token, ws: WS })],
    ['DELETE /workflows/:id', async (u) => req('DELETE', `/workflows/${await makeWorkflow(owner, WS, 'delete me')}`, { token: u.token, ws: WS })],
  ],
  // spec/30: publishing and rolling back change what triggers run.
  'workflow:publish': [
    ['POST /workflows/:id/publish', async (u) => {
      const r = await req('POST', '/workflows', { body: { name: 'publish me' }, token: owner.token, ws: WS });
      await req('PUT', `/workflows/${r.body?._id}`, { body: quickGraph, token: owner.token, ws: WS });
      return req('POST', `/workflows/${r.body?._id}/publish`, { body: {}, token: u.token, ws: WS });
    }],
    ['POST /workflows/:id/versions/:n/rollback', async (u) => req('POST', `/workflows/${await makeWorkflow(owner, WS, 'roll me back')}/versions/1/rollback`, { body: {}, token: u.token, ws: WS })],
  ],
  'workflow:run': [
    ['POST /workflows/:id/runs', async (u) => req('POST', `/workflows/${await makeWorkflow(owner, WS, 'run me')}/runs`, { token: u.token, ws: WS })],
    ['POST /runs/:id/cancel', async (u) => {
      const wf = await makeWorkflow(owner, WS, 'cancel me', slowGraph(1500));
      const run = (await req('POST', `/workflows/${wf}/runs`, { token: owner.token, ws: WS })).body?.runId;
      await sleep(150);
      const r = await req('POST', `/runs/${run}/cancel`, { token: u.token, ws: WS });
      if (!ok2xx(r.status)) await req('POST', `/runs/${run}/cancel`, { token: owner.token, ws: WS });
      return r;
    }],
  ],
  'triggers:manage': [
    ['PUT /workflows/:id/schedule', async (u) => req('PUT', `/workflows/${await makeWorkflow(owner, WS, 'sched')}/schedule`, { body: { cronExpression: '0 9 * * *', enabled: false }, token: u.token, ws: WS })],
    ['DELETE /workflows/:id/schedule', async (u) => req('DELETE', `/workflows/${await makeWorkflow(owner, WS, 'unsched')}/schedule`, { token: u.token, ws: WS })],
    ['POST /workflows/:id/webhook/regenerate', async (u) => req('POST', `/workflows/${await makeWorkflow(owner, WS, 'hook')}/webhook/regenerate`, { token: u.token, ws: WS })],
    ['PUT /workflows/:id/webhook', async (u) => req('PUT', `/workflows/${await makeWorkflow(owner, WS, 'hook2')}/webhook`, { body: { enabled: false }, token: u.token, ws: WS })],
    ['PUT /workflows/:id/event-trigger', async (u) => req('PUT', `/workflows/${await makeWorkflow(owner, WS, 'evt')}/event-trigger`, { body: { eventName: 'rbac.test', enabled: false }, token: u.token, ws: WS })],
    ['DELETE /workflows/:id/event-trigger', async (u) => req('DELETE', `/workflows/${await makeWorkflow(owner, WS, 'evt2')}/event-trigger`, { token: u.token, ws: WS })],
  ],
  'share:manage': [
    ['POST /workflows/:id/share', async (u) => req('POST', `/workflows/${await makeWorkflow(owner, WS, 'share')}/share`, { token: u.token, ws: WS })],
    ['DELETE /workflows/:id/share', async (u) => {
      const wf = await makeWorkflow(owner, WS, 'unshare');
      await req('POST', `/workflows/${wf}/share`, { token: owner.token, ws: WS });
      return req('DELETE', `/workflows/${wf}/share`, { token: u.token, ws: WS });
    }],
  ],
  'templates:create': [
    ['POST /templates', (u) => req('POST', '/templates', { body: { workflowId: sharedWf, name: `tpl ${uniq()}` }, token: u.token, ws: WS })],
  ],
  'templates:use': [
    ['POST /templates/:id/use', (u) => req('POST', `/templates/${builtIn?.id || builtIn?._id}/use`, { body: {}, token: u.token, ws: WS })],
  ],
  'members:read': [
    ['GET /workspaces/:id/members', (u) => req('GET', `/workspaces/${WS}/members`, { token: u.token })],
  ],
  'members:invite': [
    ['POST /workspaces/:id/invitations', (u) => req('POST', `/workspaces/${WS}/invitations`, { body: { email: newEmail('inv'), role: 'viewer' }, token: u.token })],
    ['GET /workspaces/:id/invitations', (u) => req('GET', `/workspaces/${WS}/invitations`, { token: u.token })],
  ],
  'members:manage': [
    ['PATCH /workspaces/:id/members/:userId (viewer→editor)', async (u) => {
      const target = await join(owner, WS, 'viewer', 'target');
      return req('PATCH', `/workspaces/${WS}/members/${target.user.id}`, { body: { role: 'editor' }, token: u.token });
    }],
    ['DELETE /workspaces/:id/members/:userId (a viewer)', async (u) => {
      const target = await join(owner, WS, 'viewer', 'target');
      return req('DELETE', `/workspaces/${WS}/members/${target.user.id}`, { token: u.token });
    }],
  ],
  'workspace:update': [
    ['PATCH /workspaces/:id', (u) => req('PATCH', `/workspaces/${WS}`, { body: { name: `RBAC Team ${uniq()}` }, token: u.token })],
  ],
  'workspace:delete': [
    ['DELETE /workspaces/:id (throwaway)', async (u, role) => {
      const t = await req('POST', '/workspaces', { body: { name: `Throwaway ${uniq()}` }, token: owner.token });
      if (role !== 'owner') {
        const inv = await invite(owner, t.body.id, u.email, role);
        await req('POST', `/invitations/${inv.token}/accept`, { token: u.token });
      }
      return req('DELETE', `/workspaces/${t.body.id}`, { body: { confirmName: t.body.name }, token: u.token });
    }],
  ],
  'workspace:billing': [
    // Re-selecting the current plan: allowed calls change nothing for later probes.
    ['PATCH /workspaces/:id/plan', (u) => req('PATCH', `/workspaces/${WS}/plan`, { body: { plan: 'enterprise' }, token: u.token })],
  ],
  'apiKeys:manage': [
    ['GET /workspaces/:id/api-keys', (u) => req('GET', `/workspaces/${WS}/api-keys`, { token: u.token })],
    ['POST /workspaces/:id/api-keys', (u) => req('POST', `/workspaces/${WS}/api-keys`, { body: { name: 'k', scopes: ['events:publish'] }, token: u.token })],
  ],
};
// Rows whose endpoints belong to specs that aren't implemented yet. They are
// still checked for shape above (permissionsFor), just not over HTTP.
const DEFERRED = {
  'connections:manage': '25', 'connections:use': '25', 'audit:read': '34',
  'code:author': '31', 'runs:approve': '32', 'runs:approve_any': '32', 'comments:write': '29',
  'comments:moderate': '29',
};

for (const action of Object.keys(PERMISSIONS)) {
  if (!PROBES[action]) {
    if (DEFERRED[action]) console.log(`  · ${action}: endpoints arrive with spec ${DEFERRED[action]} (not probed yet)`);
    else check(`${action} has a probe in this script`, false, 'add one to PROBES or DEFERRED');
    continue;
  }
  for (const [label, probe] of PROBES[action]) {
    const results = [];
    for (const role of ROLES) {
      const r = await probe(U[role], role);
      const allowed = can(role, action);
      results.push({ role, allowed, status: r.status, good: allowed ? ok2xx(r.status) : r.status === 403 });
    }
    const bad = results.filter((x) => !x.good);
    check(`${action.padEnd(17)} ${label}`, bad.length === 0,
      bad.map((x) => `${x.role}: expected ${x.allowed ? '2xx' : '403'} got ${x.status}`).join('; '));
  }
}

// ------------------------------------------------------------------ invitations
console.log('\nC. invitation lifecycle');
{
  const email = `InViTeE${uniq()}@RBAC.dev`; // mixed case on purpose: matching is case-insensitive
  const inv = await invite(owner, WS, email, 'editor');
  check('invite -> 201 with invitation + inviteUrl', inv.status === 201 && inv.body?.invitation && /\/invite\/[^/]+$/.test(inv.body?.inviteUrl || ''), `${inv.status} ${JSON.stringify(inv.body)}`);
  check('invitation payload never includes the token or its hash', !JSON.stringify(inv.body.invitation).includes(inv.token) && !('tokenHash' in (inv.body.invitation || {})));

  const again = await invite(owner, WS, email.toLowerCase(), 'editor');
  const pendingCount = await db.collection('invitations').countDocuments({ workspaceId: new mongoose.Types.ObjectId(WS), email: email.toLowerCase(), status: 'pending' });
  check('re-inviting a pending address reuses the invite (1 pending, not 2)', ok2xx(again.status) && pendingCount === 1, `${again.status} pending=${pendingCount}`);
  const liveToken = again.token || inv.token;

  const pub = await req('GET', `/invitations/${liveToken}`);
  check('public GET /invitations/:token works signed out', pub.status === 200
    && pub.body?.email === email.toLowerCase() && pub.body?.role === 'editor' && pub.body?.status === 'pending' && pub.body?.workspaceName,
    `${pub.status} ${JSON.stringify(pub.body)}`);
  check('public invite payload has no token/hash/workspace id', !('tokenHash' in (pub.body || {})) && !('token' in (pub.body || {})));

  const list = await req('GET', `/workspaces/${WS}/invitations`, { token: owner.token });
  const listed = JSON.stringify(list.body || []);
  check('pending list includes it but never a token', list.status === 200 && listed.includes(email.toLowerCase()) && !listed.includes(liveToken) && !listed.includes('tokenHash'));

  // tokens are stored hashed
  const doc = await db.collection('invitations').findOne({ email: email.toLowerCase(), workspaceId: new mongoose.Types.ObjectId(WS), status: 'pending' });
  const hash = crypto.createHash('sha256').update(liveToken).digest('hex');
  check('DB stores only sha256(token)', doc && doc.tokenHash === hash && !JSON.stringify(doc).includes(liveToken));

  const stranger = await register('stranger');
  const wrong = await req('POST', `/invitations/${liveToken}/accept`, { token: stranger.token });
  check('accepting as a different email -> 403 naming the invited address', wrong.status === 403 && String(wrong.body?.error || '').includes(email.toLowerCase()), `${wrong.status} ${wrong.body?.error}`);

  // Outbox: only the recipient sees it
  const invitee = await register('invitee', email.toLowerCase());
  const box = await req('GET', '/outbox', { token: invitee.token });
  const boxStr = JSON.stringify(box.body || []);
  check('invitee\'s /outbox has the invite message with the link', box.status === 200 && boxStr.includes('/invite/'), `${box.status}`);
  const ownerBox = JSON.stringify((await req('GET', '/outbox', { token: owner.token })).body || []);
  const strangerBox = JSON.stringify((await req('GET', '/outbox', { token: stranger.token })).body || []);
  check('nobody else\'s outbox contains it', !ownerBox.includes(email.toLowerCase()) && !strangerBox.includes(email.toLowerCase()));

  const accepted = await req('POST', `/invitations/${liveToken}/accept`, { token: invitee.token });
  check('right email (case-insensitive) accepts -> 200 with role editor', accepted.status === 200 && accepted.body?.workspace?.role === 'editor', `${accepted.status} ${JSON.stringify(accepted.body)}`);
  const m = (await members(WS)).find((x) => String(x.userId) === invitee.user.id);
  check('membership created with the invited role', m?.role === 'editor');
  const reuse = await req('POST', `/invitations/${liveToken}/accept`, { token: invitee.token });
  check('an accepted token -> 404', reuse.status === 404, `${reuse.status}`);
  check('accepted token\'s public GET -> 404', (await req('GET', `/invitations/${liveToken}`)).status === 404);

  const dup = await invite(owner, WS, email.toLowerCase(), 'viewer');
  check('inviting an existing member -> 409', dup.status === 409, `${dup.status}`);

  // resend
  const e2 = newEmail('resend');
  const i2 = await invite(owner, WS, e2, 'viewer');
  const rs = await req('POST', `/workspaces/${WS}/invitations/${i2.invId}/resend`, { token: owner.token });
  const newTok = tokenFromUrl(rs.body?.inviteUrl);
  check('resend -> new inviteUrl', ok2xx(rs.status) && newTok && newTok !== i2.token, `${rs.status}`);
  check('the old link stops working (404)', (await req('GET', `/invitations/${i2.token}`)).status === 404);
  check('the new link works', (await req('GET', `/invitations/${newTok}`)).status === 200);

  // revoke
  const e3 = newEmail('revoke');
  const i3 = await invite(owner, WS, e3, 'viewer');
  const rv = await req('DELETE', `/workspaces/${WS}/invitations/${i3.invId}`, { token: owner.token });
  check('revoke -> 204', rv.status === 204, `${rv.status}`);
  check('revoked link GET -> 404', (await req('GET', `/invitations/${i3.token}`)).status === 404);
  const u3 = await register('revoked', e3);
  check('revoked link accept -> 404', (await req('POST', `/invitations/${i3.token}/accept`, { token: u3.token })).status === 404);

  // expired
  const e4 = newEmail('expired');
  const i4 = await invite(owner, WS, e4, 'viewer');
  await db.collection('invitations').updateOne({ tokenHash: crypto.createHash('sha256').update(i4.token).digest('hex') }, { $set: { expiresAt: new Date(Date.now() - 60_000) } });
  const g4 = await req('GET', `/invitations/${i4.token}`);
  check('expired link GET -> status "expired"', g4.body?.status === 'expired', `${g4.status} ${JSON.stringify(g4.body)}`);
  const u4 = await register('expired', e4);
  check('expired link accept -> 410', (await req('POST', `/invitations/${i4.token}/accept`, { token: u4.token })).status === 410);

  check('unknown token -> 404', (await req('GET', `/invitations/${'f'.repeat(64)}`)).status === 404);
  const toOwner = await invite(owner, WS, newEmail('toowner'), 'owner');
  check('inviting straight to owner is rejected (400)', toOwner.status === 400, `${toOwner.status}`);
  const adminInvitesAdmin = await req('POST', `/workspaces/${WS}/invitations`, { body: { email: newEmail('adm'), role: 'admin' }, token: U.admin.token });
  check('an admin cannot invite an admin (403)', adminInvitesAdmin.status === 403, `${adminInvitesAdmin.status}`);
  const ownerInvitesAdmin = await invite(owner, WS, newEmail('adm'), 'admin');
  check('an owner can invite an admin (201)', ownerInvitesAdmin.status === 201, `${ownerInvitesAdmin.status}`);
}

// ------------------------------------------------------------------ members rules
console.log('\nD. members management rules');
{
  const solo = await register('solo');
  const soloWs = (await req('POST', '/workspaces', { body: { name: `Solo ${uniq()}` }, token: solo.token })).body;
  const self = solo.user.id;
  check('last owner cannot demote themselves (400)', (await req('PATCH', `/workspaces/${soloWs.id}/members/${self}`, { body: { role: 'admin' }, token: solo.token })).status === 400);
  check('last owner cannot leave (400)', (await req('DELETE', `/workspaces/${soloWs.id}/members/${self}`, { token: solo.token })).status === 400);

  const admin = U.admin;
  const r1 = await req('PATCH', `/workspaces/${WS}/members/${owner.user.id}`, { body: { role: 'editor' }, token: admin.token });
  check('admin cannot change an owner (403)', r1.status === 403, `${r1.status}`);
  const r2 = await req('DELETE', `/workspaces/${WS}/members/${owner.user.id}`, { token: admin.token });
  check('admin cannot remove an owner (403)', r2.status === 403, `${r2.status}`);
  const admin2 = await join(owner, WS, 'admin', 'admin2');
  const r3 = await req('PATCH', `/workspaces/${WS}/members/${admin2.user.id}`, { body: { role: 'viewer' }, token: admin.token });
  check('admin cannot change another admin (403)', r3.status === 403, `${r3.status}`);
  const r4 = await req('DELETE', `/workspaces/${WS}/members/${admin2.user.id}`, { token: admin.token });
  check('admin cannot remove another admin (403)', r4.status === 403, `${r4.status}`);
  const v = await join(owner, WS, 'viewer', 'promo');
  const r5 = await req('PATCH', `/workspaces/${WS}/members/${v.user.id}`, { body: { role: 'admin' }, token: admin.token });
  check('admin cannot promote anyone to admin (403)', r5.status === 403, `${r5.status}`);
  const r6 = await req('PATCH', `/workspaces/${WS}/members/${admin.user.id}`, { body: { role: 'editor' }, token: admin.token });
  check('admin cannot change their own role (403)', r6.status === 403, `${r6.status}`);
  const r7 = await req('PATCH', `/workspaces/${WS}/members/${v.user.id}`, { body: { role: 'editor' }, token: admin.token });
  check('admin CAN change a viewer to editor', ok2xx(r7.status) && (await members(WS)).find((x) => String(x.userId) === v.user.id)?.role === 'editor', `${r7.status}`);

  const r8 = await req('PATCH', `/workspaces/${WS}/members/${v.user.id}`, { body: { role: 'superuser' }, token: owner.token });
  check('unknown role -> 400', r8.status === 400, `${r8.status}`);

  // leaving
  const leaver = await join(owner, WS, 'editor', 'leaver');
  const lv = await req('DELETE', `/workspaces/${WS}/members/${leaver.user.id}`, { token: leaver.token });
  check('any non-last-owner member can leave (204)', lv.status === 204, `${lv.status}`);
  const after = await req('GET', '/workflows', { token: leaver.token, ws: WS });
  check('after leaving, the workspace is 404 for them', after.status === 404, `${after.status}`);

  // ownership transfer: promote, then step down
  const heir = await join(owner, WS, 'editor', 'heir');
  const up = await req('PATCH', `/workspaces/${WS}/members/${heir.user.id}`, { body: { role: 'owner' }, token: owner.token });
  check('owner can promote another member to owner (multiple owners)', ok2xx(up.status), `${up.status}`);
  const down = await req('PATCH', `/workspaces/${WS}/members/${heir.user.id}`, { body: { role: 'editor' }, token: owner.token });
  check('and demote them back while another owner remains', ok2xx(down.status), `${down.status}`);

  const list = await req('GET', `/workspaces/${WS}/members`, { token: U.viewer.token });
  const row = (list.body || []).find((x) => x.userId === owner.user.id);
  check('members list rows carry userId, email, name, role, joinedAt', row && row.email && row.role === 'owner' && 'joinedAt' in row && 'name' in row, JSON.stringify(row));
}

// ------------------------------------------------------------------ sharing switch
console.log('\nE. workspace-wide public sharing switch');
{
  const wf = await makeWorkflow(owner, WS, 'shared thing');
  const sh = await req('POST', `/workflows/${wf}/share`, { token: owner.token, ws: WS });
  const tok = sh.body?.shareToken;
  check('share link works while sharing is on', (await req('GET', `/shared/${tok}`)).status === 200);
  const off = await req('PATCH', `/workspaces/${WS}`, { body: { settings: { publicSharing: false } }, token: U.admin.token });
  check('admin turns public sharing off', ok2xx(off.status) && off.body?.settings?.publicSharing === false, `${off.status} ${JSON.stringify(off.body?.settings)}`);
  check('existing share link now 404s', (await req('GET', `/shared/${tok}`)).status === 404);
  const again = await req('POST', `/workflows/${wf}/share`, { token: owner.token, ws: WS });
  check('creating a new share link -> 403', again.status === 403, `${again.status} ${again.body?.error}`);
  const on = await req('PATCH', `/workspaces/${WS}`, { body: { settings: { publicSharing: true } }, token: owner.token });
  check('sharing back on', ok2xx(on.status));
  check('the old link stays dead (tokens were cleared, not paused)', (await req('GET', `/shared/${tok}`)).status === 404);
  const fresh = await req('POST', `/workflows/${wf}/share`, { token: owner.token, ws: WS });
  check('a new link can be generated and works', ok2xx(fresh.status) && (await req('GET', `/shared/${fresh.body?.shareToken}`)).status === 200);
  const edt = await req('PATCH', `/workspaces/${WS}`, { body: { settings: { publicSharing: false } }, token: U.editor.token });
  check('an editor cannot flip the switch (403)', edt.status === 403, `${edt.status}`);
}

// ------------------------------------------------------------------ capability leaks
console.log('\nF. webhook token is only visible to roles that can manage triggers');
{
  const wf = await makeWorkflow(owner, WS, 'webhook holder');
  const gen = await req('POST', `/workflows/${wf}/webhook/regenerate`, { token: owner.token, ws: WS });
  const tok = gen.body?.token;
  check('owner generated a webhook token', Boolean(tok), `${gen.status}`);
  for (const role of ['owner', 'admin', 'editor', 'viewer']) {
    const got = await req('GET', `/workflows/${wf}`, { token: U[role].token, ws: WS });
    const seen = got.body?.webhook?.token;
    const expect = role === 'viewer' ? null : tok;
    check(`${role} ${role === 'viewer' ? 'does not receive' : 'receives'} webhook.token on GET /workflows/:id`, got.status === 200 && seen === expect, `${got.status} token=${seen ? 'present' : seen}`);
  }
}

// ------------------------------------------------------------------ code:author on PUT
console.log('\nG. PUT cannot be used to get around code:author (spec 31)');
{
  const wf = await makeWorkflow(owner, WS, 'code holder');
  const codeGraph = { nodes: [...quickGraph.nodes, N('c', 'code', { label: 'Code', source: 'return 1;' })], edges: quickGraph.edges };
  const byEditor = await req('PUT', `/workflows/${wf}`, { body: codeGraph, token: U.editor.token, ws: WS });
  check('editor PUT adding a Code node -> 403', byEditor.status === 403, `${byEditor.status} ${byEditor.body?.error}`);
  const byOwner = await req('PUT', `/workflows/${wf}`, { body: codeGraph, token: owner.token, ws: WS });
  check('owner PUT adding a Code node -> 200', byOwner.status === 200, `${byOwner.status} ${byOwner.body?.error}`);
  const edited = { ...codeGraph, nodes: codeGraph.nodes.map((n) => (n.id === 'c' ? N('c', 'code', { label: 'Code', source: 'return 2;' }) : n)) };
  const editSrc = await req('PUT', `/workflows/${wf}`, { body: edited, token: U.editor.token, ws: WS });
  check("editor PUT changing a Code node's source -> 403", editSrc.status === 403, `${editSrc.status}`);
  const bogus = await req('PUT', `/workflows/${wf}`, { body: { nodes: [N('x', 'teleporter', {})], edges: [] }, token: owner.token, ws: WS });
  check('unknown node type rejected with 400', bogus.status === 400, `${bogus.status} ${bogus.body?.error}`);
}

await mongoose.disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
