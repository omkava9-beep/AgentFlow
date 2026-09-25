/**
 * Audit-log check for spec/34 - the acceptance criteria as a runnable script.
 * Needs a running server and its database:
 *
 *   PORT=4500 MONGODB_URI=...-check npm run dev                        # terminal 1
 *   BASE=http://localhost:4500/api MONGODB_URI=... npm run check:audit  # terminal 2
 *
 * Every administrative action that exists today is performed over HTTP and must
 * leave exactly one AuditEvent with the right actor, target and summary. Every
 * secret the script creates along the way (API keys, webhook/share/invite
 * tokens) is then searched for across every audit document, at any depth.
 */
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import AuditEvent from '../models/AuditEvent.js';
import { audit, auditSystem } from '../services/audit.js';

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

async function req(method, p, { body, token, ws, raw = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (ws) headers['X-Workspace-Id'] = String(ws);
  const res = await fetch(B + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = text && !raw ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, body: json, text, headers: res.headers };
}

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const newEmail = (tag) => `${tag}${uniq()}@audit.dev`;
async function register(tag, email = newEmail(tag)) {
  const r = await req('POST', '/auth/register', { body: { email, password: 'password123', name: tag } });
  return { token: r.body?.token, user: r.body?.user, email, personal: r.body?.workspaces?.[0]?.id };
}
const tokenFromUrl = (url) => String(url || '').split('/invite/').pop();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Every secret created during the run; section H searches the log for all of them.
const SECRETS = new Set();
const remember = (...values) => values.filter(Boolean).forEach((v) => SECRETS.add(String(v)));

async function invite(owner, ws, email, role) {
  const r = await req('POST', `/workspaces/${ws}/invitations`, { body: { email, role }, token: owner.token });
  const token = tokenFromUrl(r.body?.inviteUrl);
  remember(token, token && sha256(token));
  return { ...r, token, invId: r.body?.invitation?.id };
}
async function join(owner, ws, role, tag = role) {
  const email = newEmail(tag);
  const inv = await invite(owner, ws, email, role);
  const u = await register(tag, email);
  await req('POST', `/invitations/${inv.token}/accept`, { token: u.token });
  return u;
}

await mongoose.connect(DB_URI);
const col = mongoose.connection.db.collection('auditevents');
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const events = (ws, filter = {}) => col.find({ workspaceId: oid(ws), ...filter }).sort({ createdAt: 1, _id: 1 }).toArray();
const one = async (ws, filter) => {
  const found = await events(ws, filter);
  return { count: found.length, e: found[0] };
};

// ------------------------------------------------------------------ A. workspaces
console.log('A. workspace.created');
const owner = await register('owner');
{
  const { count, e } = await one(owner.personal, { action: 'workspace.created' });
  check('registration records one workspace.created for the personal workspace', count === 1 && e?.actorType === 'user' && String(e?.actorId) === owner.user?.id, `count=${count}`);
  check('actor email is snapshotted into actorLabel', e?.actorLabel === owner.email, e?.actorLabel);
}
const wsRes = await req('POST', '/workspaces', { body: { name: `Audit Team ${uniq()}` }, token: owner.token });
const WS = wsRes.body?.id;
{
  const { count, e } = await one(WS, { action: 'workspace.created' });
  check('creating a team workspace records exactly one workspace.created', count === 1 && e?.targetType === 'workspace' && String(e?.targetId) === WS, `count=${count}`);
  check('summary is a readable sentence', /created workspace "Audit Team/.test(e?.summary || ''), e?.summary);
}

// ------------------------------------------------------------------ B. invitations
console.log('\nB. invitations');
const inviteeEmail = newEmail('invitee');
let invitee;
{
  const inv = await invite(owner, WS, inviteeEmail, 'editor');
  check('invite created', inv.status === 201, `${inv.status}`);
  const created = await one(WS, { action: 'member.invited' });
  check('member.invited recorded once, target = invitation email, meta.role', created.count === 1 && created.e?.targetType === 'invitation' && created.e?.targetLabel === inviteeEmail && created.e?.meta?.role === 'editor', JSON.stringify(created.e?.meta));

  const resent = await req('POST', `/workspaces/${WS}/invitations/${inv.invId}/resend`, { token: owner.token });
  const t2 = tokenFromUrl(resent.body?.inviteUrl); remember(t2, t2 && sha256(t2));
  check('invitation.resent recorded once', (await one(WS, { action: 'invitation.resent' })).count === 1);

  invitee = await register('invitee', inviteeEmail);
  const acc = await req('POST', `/invitations/${t2}/accept`, { token: invitee.token });
  check('invitee accepts', acc.status === 200, `${acc.status}`);
  const accepted = await one(WS, { action: 'invitation.accepted' });
  check('invitation.accepted recorded once with the invitee as actor', accepted.count === 1 && String(accepted.e?.actorId) === invitee.user?.id && accepted.e?.meta?.role === 'editor', `${accepted.count} ${accepted.e?.actorLabel}`);

  const other = await invite(owner, WS, newEmail('revoked'), 'viewer');
  const rv = await req('DELETE', `/workspaces/${WS}/invitations/${other.invId}`, { token: owner.token });
  const revoked = await one(WS, { action: 'invitation.revoked' });
  check('invitation.revoked recorded once', rv.status === 204 && revoked.count === 1 && revoked.e?.targetId && String(revoked.e.targetId) === other.invId, `${rv.status} ${revoked.count}`);
}

// ------------------------------------------------------------------ C. members
console.log('\nC. members');
const admin = await join(owner, WS, 'admin');
const viewer = await join(owner, WS, 'viewer');
{
  const up = await req('PATCH', `/workspaces/${WS}/members/${invitee.user.id}`, { body: { role: 'viewer' }, token: owner.token });
  const rc = await one(WS, { action: 'member.role_changed' });
  check('member.role_changed recorded once with before/after roles', up.status === 200 && rc.count === 1 && rc.e?.before?.role === 'editor' && rc.e?.after?.role === 'viewer', `${up.status} ${JSON.stringify([rc.e?.before, rc.e?.after])}`);
  check('role-change summary names both roles', /from editor to viewer/.test(rc.e?.summary || ''), rc.e?.summary);
  await req('PATCH', `/workspaces/${WS}/members/${invitee.user.id}`, { body: { role: 'viewer' }, token: owner.token });
  check('a no-op role change writes nothing', (await one(WS, { action: 'member.role_changed' })).count === 1);

  const rm = await req('DELETE', `/workspaces/${WS}/members/${invitee.user.id}`, { token: admin.token });
  const removed = await one(WS, { action: 'member.removed' });
  check('member.removed recorded once, actor = admin, target = removed email', rm.status === 204 && removed.count === 1 && String(removed.e?.actorId) === admin.user.id && removed.e?.targetLabel === inviteeEmail, `${rm.status} ${removed.count}`);

  const leaver = await join(owner, WS, 'editor', 'leaver');
  const lv = await req('DELETE', `/workspaces/${WS}/members/${leaver.user.id}`, { token: leaver.token });
  const left = await one(WS, { action: 'member.left' });
  check('member.left recorded once, actor = the leaver', lv.status === 204 && left.count === 1 && String(left.e?.actorId) === leaver.user.id, `${lv.status} ${left.count}`);
  const failed = await req('PATCH', `/workspaces/${WS}/members/${owner.user.id}`, { body: { role: 'viewer' }, token: admin.token });
  check('a refused change (admin demoting owner, 403) writes nothing', failed.status === 403 && (await one(WS, { action: 'member.role_changed' })).count === 1, `${failed.status}`);
}

// ------------------------------------------------------------------ D. API keys
console.log('\nD. API keys');
let apiKeyId;
{
  const cr = await req('POST', `/workspaces/${WS}/api-keys`, { body: { name: 'zapier', scopes: ['events:publish'] }, token: owner.token });
  apiKeyId = cr.body?.apiKey?.id;
  remember(cr.body?.key, cr.body?.key && sha256(cr.body.key));
  const created = await one(WS, { action: 'apikey.created' });
  check('apikey.created recorded once with name, prefix and scopes', cr.status === 201 && created.count === 1 && created.e?.targetLabel === 'zapier' && created.e?.meta?.prefix === cr.body?.apiKey?.prefix && created.e?.meta?.scopes?.[0] === 'events:publish', JSON.stringify(created.e?.meta));
  const rv = await req('DELETE', `/workspaces/${WS}/api-keys/${apiKeyId}`, { token: owner.token });
  await req('DELETE', `/workspaces/${WS}/api-keys/${apiKeyId}`, { token: owner.token });
  check('apikey.revoked recorded once (a repeat revoke is idempotent and silent)', rv.status === 204 && (await one(WS, { action: 'apikey.revoked' })).count === 1);
}

// ------------------------------------------------------------------ E. workspace settings + sharing
console.log('\nE. workspace settings and sharing');
const wfRes = await req('POST', '/workflows', { body: { name: 'Audited flow' }, token: owner.token, ws: WS });
const WF = wfRes.body?._id;
{
  const oldName = wsRes.body?.name;
  const newSlug = `audit-${uniq()}`.slice(0, 30);
  const up = await req('PATCH', `/workspaces/${WS}`, { body: { name: 'Audit Renamed', slug: newSlug }, token: owner.token });
  const upd = await one(WS, { action: 'workspace.updated' });
  check('workspace.updated recorded once with only the changed fields', up.status === 200 && upd.count === 1 && upd.e?.before?.name === oldName && upd.e?.after?.name === 'Audit Renamed' && upd.e?.after?.slug === newSlug && !('settings' in (upd.e?.after || {})), JSON.stringify(upd.e?.after));

  const sh = await req('POST', `/workflows/${WF}/share`, { token: owner.token, ws: WS });
  remember(sh.body?.shareToken);
  check('share.enabled recorded', (await one(WS, { action: 'share.enabled', targetId: oid(WF) })).count === 1);
  const sh2 = await req('POST', `/workflows/${WF}/share`, { token: owner.token, ws: WS });
  remember(sh2.body?.shareToken);
  await req('DELETE', `/workflows/${WF}/share`, { token: owner.token, ws: WS });
  check('share.disabled recorded once', (await one(WS, { action: 'share.disabled' })).count === 1);

  // Two live links, then the kill switch: one bulk event, not one per link.
  const wf2 = (await req('POST', '/workflows', { body: { name: 'Second shared' }, token: owner.token, ws: WS })).body?._id;
  remember((await req('POST', `/workflows/${WF}/share`, { token: owner.token, ws: WS })).body?.shareToken);
  remember((await req('POST', `/workflows/${wf2}/share`, { token: owner.token, ws: WS })).body?.shareToken);
  const off = await req('PATCH', `/workspaces/${WS}`, { body: { settings: { publicSharing: false } }, token: admin.token });
  const kill = await one(WS, { action: 'share.disabled_workspace' });
  check('kill switch writes one share.disabled_workspace with meta.count = 2', off.status === 200 && kill.count === 1 && kill.e?.meta?.count === 2 && kill.e?.targetType === 'workspace', `${off.status} ${JSON.stringify(kill.e?.meta)}`);
  check('the kill switch does not also write a workspace.updated', (await one(WS, { action: 'workspace.updated' })).count === 1);
  await req('PATCH', `/workspaces/${WS}`, { body: { settings: { publicSharing: true } }, token: owner.token });
  const on = await events(WS, { action: 'workspace.updated' });
  check('turning sharing back on is a workspace.updated with settings before/after', on.length === 2 && on[1]?.after?.settings?.publicSharing === true && on[1]?.before?.settings?.publicSharing === false, JSON.stringify(on[1]?.after));
}

// ------------------------------------------------------------------ F. triggers
console.log('\nF. triggers');
{
  await req('PUT', `/workflows/${WF}/schedule`, { body: { cronExpression: '0 9 * * *', enabled: true }, token: owner.token, ws: WS });
  await req('DELETE', `/workflows/${WF}/schedule`, { token: owner.token, ws: WS });
  const sched = await events(WS, { action: 'trigger.updated', 'meta.kind': 'schedule' });
  check('schedule put + delete -> two trigger.updated (kind schedule)', sched.length === 2 && sched[0]?.after?.cronExpression === '0 9 * * *' && sched[1]?.after?.enabled === false, `${sched.length}`);

  const regen = await req('POST', `/workflows/${WF}/webhook/regenerate`, { token: owner.token, ws: WS });
  remember(regen.body?.token);
  check('webhook.regenerated recorded once', (await one(WS, { action: 'webhook.regenerated' })).count === 1);
  await req('PUT', `/workflows/${WF}/webhook`, { body: { enabled: false }, token: owner.token, ws: WS });
  const hook = await one(WS, { action: 'trigger.updated', 'meta.kind': 'webhook' });
  check('webhook enable/disable -> trigger.updated (kind webhook) without the token', hook.count === 1 && hook.e?.after?.enabled === false && !JSON.stringify(hook.e).includes(regen.body?.token), JSON.stringify(hook.e?.after));

  await req('PUT', `/workflows/${WF}/event-trigger`, { body: { eventName: 'order.created', enabled: true }, token: owner.token, ws: WS });
  await req('DELETE', `/workflows/${WF}/event-trigger`, { token: owner.token, ws: WS });
  const ev = await events(WS, { action: 'trigger.updated', 'meta.kind': 'event' });
  check('event trigger put + delete -> two trigger.updated (kind event)', ev.length === 2 && ev[0]?.after?.eventName === 'order.created', `${ev.length}`);
  const bad = await req('PUT', `/workflows/${WF}/schedule`, { body: { cronExpression: 'nope', enabled: true }, token: owner.token, ws: WS });
  check('a rejected change (400) writes nothing', bad.status === 400 && (await events(WS, { action: 'trigger.updated', 'meta.kind': 'schedule' })).length === 2);
}

// ------------------------------------------------------------------ G. workflow deletion
console.log('\nG. workflow.deleted');
{
  const doomed = (await req('POST', '/workflows', { body: { name: 'Doomed flow' }, token: owner.token, ws: WS })).body?._id;
  const del = await req('DELETE', `/workflows/${doomed}`, { token: owner.token, ws: WS });
  const d = await one(WS, { action: 'workflow.deleted' });
  check('workflow.deleted recorded once with the name snapshot', del.status === 204 && d.count === 1 && d.e?.targetLabel === 'Doomed flow', `${del.status} ${d.count}`);
  const list = await req('GET', `/workspaces/${WS}/audit?action=workflow.deleted`, { token: owner.token });
  check('a deleted target is flagged targetExists=false for the UI', list.body?.items?.[0]?.targetExists === false, JSON.stringify(list.body?.items?.[0]?.targetExists));
}

// ------------------------------------------------------------------ H. no secrets anywhere
console.log('\nH. redaction: no secret created above appears in any audit document');
{
  const all = await col.find({}).toArray();
  const blob = JSON.stringify(all);
  const leaked = [...SECRETS].filter((s) => s.length >= 8 && blob.includes(s));
  check(`searched ${all.length} audit documents for ${SECRETS.size} secrets — none found`, SECRETS.size >= 8 && leaked.length === 0, leaked.map((s) => `${s.slice(0, 6)}…`).join(', '));

  // Direct helper call: secret-named keys, token-looking values, long strings.
  await audit({ userId: owner.user.id, workspaceId: WS }, 'connection.updated', { type: 'connection', id: new mongoose.Types.ObjectId(), name: 'redaction probe' }, {
    before: { password: 'hunter2hunter2', nested: { apiKey: 'abc12345', note: 'x'.repeat(600) } },
    after: { mode: 'live', header: 'Bearer supersecretvalue123', webhookUrl: 'https://hooks.slack.com/services/T0/B0/XYZ', botToken: 'xoxb-1234-abcd' },
    secretKeys: ['webhookUrl'],
  });
  const probe = (await one(WS, { action: 'connection.updated' })).e;
  check('secret-named keys become "[redacted]" at any depth', probe?.before?.password === '[redacted]' && probe?.before?.nested?.apiKey === '[redacted]' && probe?.after?.botToken === '[redacted]', JSON.stringify(probe?.before));
  check('schema-secret fields and token-looking values are redacted', probe?.after?.webhookUrl === '[redacted]' && probe?.after?.header === '[redacted]', JSON.stringify(probe?.after));
  check('long strings are truncated to 500 characters', probe?.before?.nested?.note?.length <= 501, `${probe?.before?.nested?.note?.length}`);
  check('non-secret fields survive', probe?.after?.mode === 'live');
}

// ------------------------------------------------------------------ I. append-only
console.log('\nI. append-only');
{
  const before = await col.countDocuments({ workspaceId: oid(WS) });
  const attempts = {
    updateOne: () => AuditEvent.updateOne({ workspaceId: WS }, { $set: { summary: 'tampered' } }),
    updateMany: () => AuditEvent.updateMany({ workspaceId: WS }, { $set: { summary: 'tampered' } }),
    findOneAndUpdate: () => AuditEvent.findOneAndUpdate({ workspaceId: WS }, { $set: { summary: 'tampered' } }),
    replaceOne: () => AuditEvent.replaceOne({ workspaceId: WS }, { summary: 'tampered' }),
    deleteOne: () => AuditEvent.deleteOne({ workspaceId: WS }),
    deleteMany: () => AuditEvent.deleteMany({ workspaceId: WS }),
    findOneAndDelete: () => AuditEvent.findOneAndDelete({ workspaceId: WS }),
    'save() on an existing doc': async () => { const d = await AuditEvent.findOne({ workspaceId: WS }); d.summary = 'tampered'; await d.save(); },
    'document deleteOne()': async () => { const d = await AuditEvent.findOne({ workspaceId: WS }); await d.deleteOne(); },
  };
  for (const [name, fn] of Object.entries(attempts)) {
    let threw = false;
    try { await fn(); } catch (err) { threw = /append-only/.test(err.message); }
    check(`${name} throws "append-only"`, threw);
  }
  const after = await col.countDocuments({ workspaceId: oid(WS) });
  const tampered = await col.countDocuments({ summary: 'tampered' });
  check('nothing was modified or removed', before === after && tampered === 0, `${before} -> ${after}, tampered=${tampered}`);
  const put = await req('PUT', `/workspaces/${WS}/audit/${(await col.findOne({ workspaceId: oid(WS) }))._id}`, { body: {}, token: owner.token });
  const del = await req('DELETE', `/workspaces/${WS}/audit`, { token: owner.token });
  check('there are no update or delete routes (404)', put.status === 404 && del.status === 404, `${put.status} ${del.status}`);
}

// ------------------------------------------------------------------ J. access
console.log('\nJ. who can read it');
{
  const editor = await join(owner, WS, 'editor', 'reader');
  for (const [name, u, expect] of [['owner', owner, 200], ['admin', admin, 200], ['editor', editor, 403], ['viewer', viewer, 403]]) {
    const list = await req('GET', `/workspaces/${WS}/audit`, { token: u.token });
    const exp = await req('GET', `/workspaces/${WS}/audit/export`, { token: u.token, raw: true });
    check(`${name}: list ${expect}, export ${expect}`, list.status === expect && exp.status === expect, `${list.status}/${exp.status}`);
  }
  const outsider = await register('outsider');
  const foreign = await req('GET', `/workspaces/${WS}/audit`, { token: outsider.token });
  check('a non-member gets 404, not 403', foreign.status === 404, `${foreign.status}`);
  const own = await req('GET', `/workspaces/${outsider.personal}/audit`, { token: outsider.token });
  check("the outsider's own log contains none of this workspace's events", own.status === 200 && own.body?.items?.every((i) => !/Audit/.test(i.summary)), `${own.body?.items?.length}`);
}

// ------------------------------------------------------------------ K. filters
console.log('\nK. filters');
{
  const get = async (qs) => (await req('GET', `/workspaces/${WS}/audit?${qs}&limit=100`, { token: owner.token })).body?.items || [];
  const exact = await get('action=member.role_changed');
  check('exact action filter', exact.length === 1 && exact[0].action === 'member.role_changed');
  const prefix = await get('action=member.*');
  const actions = new Set(prefix.map((i) => i.action));
  check('category prefix member.* matches invited/role_changed/removed/left only', prefix.length >= 4 && [...actions].every((a) => a.startsWith('member.')) && actions.has('member.left'), [...actions].join(','));
  const byActor = await get(`actorId=${admin.user.id}`);
  check('actorId filter', byActor.length >= 2 && byActor.every((i) => i.actorId === admin.user.id), `${byActor.length}`);
  const byTarget = await get('targetType=apiKey');
  check('targetType filter', byTarget.length === 2 && byTarget.every((i) => i.targetType === 'apiKey'), `${byTarget.length}`);
  const future = await get(`from=${new Date(Date.now() + 86_400_000).toISOString()}`);
  check('a future from= returns nothing', future.length === 0);
  const past = await get(`to=${new Date(Date.now() - 86_400_000).toISOString()}`);
  check('a past to= returns nothing', past.length === 0);
  const combo = await get(`action=member.*&actorId=${owner.user.id}`);
  check('filters combine (member.* AND by owner)', combo.length >= 1 && combo.every((i) => i.action.startsWith('member.') && i.actorId === owner.user.id), `${combo.length}`);
  const noSuch = await get('actorType=apiKey');
  check('actorType filter (no API-key actions in this workspace yet)', noSuch.length === 0);
  const removed = (await get('action=member.removed'))[0];
  check('a removed member keeps actor label; UI flag actorIsMember=false for the leaver', (await get('action=member.left'))[0]?.actorIsMember === false && removed?.actorIsMember === true, '');
  const badDate = await req('GET', `/workspaces/${WS}/audit?from=not-a-date`, { token: owner.token });
  check('invalid date -> 400', badDate.status === 400);
}

// ------------------------------------------------------------------ L. cursor pagination
console.log('\nL. cursor pagination while new events arrive');
{
  const existing = await col.countDocuments({ workspaceId: oid(WS) });
  const seen = [];
  let cursor = null;
  let page = 0;
  do {
    const r = await req('GET', `/workspaces/${WS}/audit?limit=4${cursor ? `&before=${cursor}` : ''}`, { token: owner.token });
    seen.push(...(r.body?.items || []).map((i) => i.id));
    cursor = r.body?.nextCursor;
    // New events land between page fetches - they must not shift later pages.
    if (page++ < 3) await req('POST', `/workspaces/${WS}/api-keys`, { body: { name: `k${page}`, scopes: ['runs:read'] }, token: owner.token }).then((x) => remember(x.body?.key));
  } while (cursor && page < 200);
  check(`walked ${page} pages: every pre-existing event exactly once (${existing})`, seen.length === existing && new Set(seen).size === seen.length, `${seen.length} seen, ${new Set(seen).size} unique`);
  const bad = await req('GET', `/workspaces/${WS}/audit?before=garbage`, { token: owner.token });
  check('an invalid cursor -> 400', bad.status === 400, `${bad.status}`);
  const big = await req('GET', `/workspaces/${WS}/audit?limit=5000`, { token: owner.token });
  check('limit is capped at 100', big.status === 200 && big.body.items.length <= 100);
}

// ------------------------------------------------------------------ M. CSV export
console.log('\nM. CSV export');
{
  const list = (await req('GET', `/workspaces/${WS}/audit?action=apikey.*&limit=100`, { token: owner.token })).body?.items || [];
  const exp = await req('GET', `/workspaces/${WS}/audit/export?action=apikey.*`, { token: owner.token, raw: true });
  const lines = exp.text.trim().split('\n');
  check('export is text/csv with an attachment filename', /text\/csv/.test(exp.headers.get('content-type') || '') && /attachment; filename="audit-/.test(exp.headers.get('content-disposition') || ''));
  check('header row + one row per filtered event', lines[0] === 'time,actor_type,actor,action,target_type,target,summary,ip' && lines.length - 1 === list.length && list.length >= 5, `${lines.length - 1} vs ${list.length}`);
  check('export honours the filter', lines.slice(1).every((l) => l.includes(',apikey.')));
}

// ------------------------------------------------------------------ N. API-key and system actors
console.log('\nN. API-key and system actors');
{
  const fakeKey = { _id: new mongoose.Types.ObjectId(), name: 'ci-bot', prefix: 'af_ABCDEFGH' };
  await audit({ apiKey: fakeKey, workspaceId: WS }, 'trigger.updated', { type: 'workflow', id: WF, name: 'Audited flow' }, { meta: { kind: 'event' } });
  const k = (await col.find({ workspaceId: oid(WS), actorType: 'apiKey' }).toArray())[0];
  check("an API-key action records actorType 'apiKey' and the key's name, not its creator", k && String(k.actorId) === String(fakeKey._id) && /ci-bot/.test(k.actorLabel), k?.actorLabel);
  await auditSystem(WS, 'workspace.plan_changed', { type: 'workspace', id: WS, name: 'Audit Renamed' }, { system: 'seed', before: { plan: 'free' }, after: { plan: 'team' } });
  const s = (await col.find({ workspaceId: oid(WS), actorType: 'system' }).toArray())[0];
  check('auditSystem records a system actor with its label', s?.actorLabel === 'seed' && /from free to team/.test(s?.summary), s?.summary);
}

// ------------------------------------------------------------------ O. workspace deletion purges
console.log('\nO. deleting a workspace purges its log (the one sanctioned delete)');
{
  const tmp = (await req('POST', '/workspaces', { body: { name: `Doomed WS ${uniq()}` }, token: owner.token })).body;
  await req('PATCH', `/workspaces/${tmp.id}`, { body: { name: 'Doomed WS renamed' }, token: owner.token });
  const beforeCount = await col.countDocuments({ workspaceId: oid(tmp.id) });
  const del = await req('DELETE', `/workspaces/${tmp.id}`, { body: { confirmName: 'Doomed WS renamed' }, token: owner.token });
  const afterCount = await col.countDocuments({ workspaceId: oid(tmp.id) });
  check('workspace delete removes its audit events', del.status === 204 && beforeCount >= 2 && afterCount === 0, `${del.status} ${beforeCount} -> ${afterCount}`);
  check("other workspaces' logs are untouched", (await col.countDocuments({ workspaceId: oid(WS) })) > 20);
}

await mongoose.disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
