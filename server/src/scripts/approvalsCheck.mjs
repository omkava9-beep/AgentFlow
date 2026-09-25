/**
 * Approvals & resumable runs check for spec/32 - the acceptance criteria as a
 * runnable script.
 *
 *   BASE=http://localhost:4500/api MONGODB_URI=... npm run check:approvals
 *
 * Sections A-L run against the server at BASE. Section M starts, kill -9s and
 * restarts its OWN server process on a throwaway database to prove that parked
 * runs survive a restart, timers are re-armed, and mid-flight runs are
 * reconciled as interrupted.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

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

function client(base) {
  return async function req(method, p, { body, token, ws } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    if (ws) headers['X-Workspace-Id'] = String(ws);
    const res = await fetch(base + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    return { status: res.status, body: json };
  };
}
let req = client(B);

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const newEmail = (tag) => `${tag}${uniq()}@approvals.dev`;
async function register(tag, email = newEmail(tag)) {
  const r = await req('POST', '/auth/register', { body: { email, password: 'password123', name: tag } });
  return { token: r.body?.token, user: r.body?.user, email, personal: r.body?.workspaces?.[0]?.id };
}
async function join(owner, ws, role, tag = role) {
  const email = newEmail(tag);
  const inv = await req('POST', `/workspaces/${ws}/invitations`, { body: { email, role }, token: owner.token });
  const u = await register(tag, email);
  await req('POST', `/invitations/${String(inv.body?.inviteUrl || '').split('/invite/').pop()}/accept`, { token: u.token });
  return u;
}

const N = (id, type, config) => ({ id, type, position: { x: 0, y: 0 }, data: { config } });
/** start → approval → approved: yes / rejected: no */
function approvalGraph(approvalConfig = {}) {
  return {
    nodes: [
      N('s', 'start', { label: 'Start' }),
      N('a', 'approval', { label: 'Approve', title: 'Refund {{input.amount}}?', description: 'Customer {{input.customer}}', minApprovals: 1, ...approvalConfig }),
      N('yes', 'end', { label: 'Approved' }),
      N('no', 'end', { label: 'Rejected' }),
    ],
    edges: [
      { id: 'e1', source: 's', target: 'a' },
      { id: 'e2', source: 'a', target: 'yes', sourceHandle: 'approved' },
      { id: 'e3', source: 'a', target: 'no', sourceHandle: 'rejected' },
    ],
  };
}
async function makeWorkflow(u, ws, name, graph) {
  const r = await req('POST', '/workflows', { body: { name }, token: u.token, ws });
  const put = await req('PUT', `/workflows/${r.body?._id}`, { body: graph, token: u.token, ws });
  if (put.status !== 200) console.log(`      (PUT ${name} → ${put.status} ${put.body?.error})`);
  return r.body?._id;
}
async function startRun(u, ws, wfId, body = {}) {
  const r = await req('POST', `/workflows/${wfId}/runs`, { token: u.token, ws, body });
  return r.body?.runId ? r.body.runId : (console.log(`      (start run → ${r.status} ${r.body?.error})`), null);
}
async function waitFor(u, ws, runId, statuses, tries = 80, every = 150) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    const r = await req('GET', `/runs/${runId}`, { token: u.token, ws });
    last = r.body;
    if (statuses.includes(r.body?.status)) return r.body;
    await sleep(every);
  }
  return last;
}
const nodeOf = (run, id) => (run?.nodeResults || []).find((r) => r.nodeId === id);
const decideReq = (u, ws, runId, decision, comment) => req('POST', `/runs/${runId}/approvals/a`, { token: u.token, ws, body: { decision, comment } });

await mongoose.connect(DB_URI);
const db = mongoose.connection.db;

// ------------------------------------------------------------------ setup
const owner = await register('owner');
const wsRes = await req('POST', '/workspaces', { body: { name: `Approvals ${uniq()}` }, token: owner.token });
const WS = wsRes.body?.id;
await req('PATCH', `/workspaces/${WS}/plan`, { body: { plan: 'enterprise' }, token: owner.token });
const admin = await join(owner, WS, 'admin');
const editor = await join(owner, WS, 'editor');
const editor2 = await join(owner, WS, 'editor', 'editor2');
const viewer = await join(owner, WS, 'viewer');

// ------------------------------------------------------------------ A: parking
console.log('A. a run reaching an Approval node parks');
const wfMain = await makeWorkflow(owner, WS, 'Refund approvals', approvalGraph({ assignees: { userIds: [editor.user.id], roles: [] } }));
let runA;
{
  runA = await startRun(owner, WS, wfMain, { input: undefined });
  const run = await waitFor(owner, WS, runA, ['waiting', 'success', 'failed']);
  check('run status is waiting', run?.status === 'waiting', run?.status);
  check('the approval node is waiting, downstream nodes pending', nodeOf(run, 'a')?.status === 'waiting' && nodeOf(run, 'yes')?.status === 'pending');
  const doc = await db.collection('runs').findOne({ _id: new mongoose.Types.ObjectId(runA) });
  check('Run.waiting lists the node with reason approval', doc?.waiting?.length === 1 && doc.waiting[0].nodeId === 'a' && doc.waiting[0].reason === 'approval');
  check('engineState.outputs holds the start node\'s downstream output', doc?.engineState && 's' in (doc.engineState.outputs || {}));
  check('assignee snapshot is the configured editor', String(nodeOf(run, 'a')?.approval?.assigneeIds) === editor.user.id);
  check('title template rendered against the input', typeof nodeOf(run, 'a')?.approval?.title === 'string' && nodeOf(run, 'a').approval.title.startsWith('Refund'));
}

// ------------------------------------------------------------------ B: inbox
console.log('\nB. approvals inbox');
{
  const mine = await req('GET', '/approvals', { token: editor.token, ws: WS });
  check('assignee sees the pending approval in their inbox', mine.status === 200 && mine.body?.some((a) => a.runId === runA && a.nodeId === 'a'), `${mine.status}`);
  const theirs = await req('GET', '/approvals', { token: viewer.token, ws: WS });
  check('a non-assignee does not', theirs.status === 200 && !theirs.body?.some((a) => a.runId === runA));
  const all = await req('GET', '/approvals?all=1', { token: admin.token, ws: WS });
  check('an admin with all=1 sees every pending approval', all.status === 200 && all.body?.some((a) => a.runId === runA));
}

// ------------------------------------------------------------------ C: approve
console.log('\nC. eligibility and the approved branch');
{
  const notMine = await decideReq(viewer, WS, runA, 'approve');
  check('an unassigned viewer gets 403', notMine.status === 403, `${notMine.status}`);
  const unassignedEditor = await decideReq(editor2, WS, runA, 'approve');
  check('an unassigned editor gets 403', unassignedEditor.status === 403, `${unassignedEditor.status}`);
  const ok = await decideReq(editor, WS, runA, 'approve', 'looks fine');
  check('the assignee approves → 200', ok.status === 200 && ok.body?.decision === 'approved', `${ok.status} ${JSON.stringify(ok.body)}`);
  const run = await waitFor(owner, WS, runA, ['success', 'failed']);
  check('run resumes and succeeds', run?.status === 'success', run?.status);
  check('approved branch ran, rejected branch skipped', nodeOf(run, 'yes')?.status === 'success' && nodeOf(run, 'no')?.status === 'skipped');
  check('approval output carries decision, decidedBy, comment and the input', nodeOf(run, 'a')?.output?.decision === 'approved' && nodeOf(run, 'a')?.output?.decidedBy?.id === editor.user.id && nodeOf(run, 'a')?.output?.comment === 'looks fine');
  const again = await decideReq(editor, WS, runA, 'approve');
  check('deciding again → 409 with the recorded decision', again.status === 409 && again.body?.decision === 'approved', `${again.status} ${JSON.stringify(again.body)}`);
}

// ------------------------------------------------------------------ D: reject
console.log('\nD. the rejected branch');
{
  const runId = await startRun(owner, WS, wfMain);
  await waitFor(owner, WS, runId, ['waiting']);
  const r = await decideReq(editor, WS, runId, 'reject', 'too much');
  check('reject → 200', r.status === 200 && r.body?.decision === 'rejected', `${r.status}`);
  const run = await waitFor(owner, WS, runId, ['success', 'failed']);
  check('run succeeds down the rejected branch (a routing outcome, not a failure)', run?.status === 'success' && nodeOf(run, 'no')?.status === 'success' && nodeOf(run, 'yes')?.status === 'skipped', run?.status);
}

// ------------------------------------------------------------------ E: concurrency
console.log('\nE. two concurrent decisions → exactly one resume');
{
  const wf = await makeWorkflow(owner, WS, 'Race', approvalGraph({ assignees: { userIds: [editor.user.id, editor2.user.id], roles: [] }, minApprovals: 1 }));
  const runId = await startRun(owner, WS, wf);
  await waitFor(owner, WS, runId, ['waiting']);
  const [x, y] = await Promise.all([decideReq(editor, WS, runId, 'approve'), decideReq(editor2, WS, runId, 'reject')]);
  const statuses = [x.status, y.status].sort();
  check('one 200, one 409', statuses[0] === 200 && statuses[1] === 409, statuses.join(','));
  const run = await waitFor(owner, WS, runId, ['success', 'failed']);
  const winner = x.status === 200 ? 'approved' : 'rejected';
  check('the winner\'s decision is the one recorded', nodeOf(run, 'a')?.output?.decision === winner, `${nodeOf(run, 'a')?.output?.decision} vs ${winner}`);
  check('exactly one branch ran', [nodeOf(run, 'yes')?.status, nodeOf(run, 'no')?.status].filter((s) => s === 'success').length === 1);
}

// ------------------------------------------------------------------ F: minApprovals
console.log('\nF. minApprovals');
{
  const wf = await makeWorkflow(owner, WS, 'Two approvers', approvalGraph({ assignees: { userIds: [editor.user.id, editor2.user.id], roles: [] }, minApprovals: 2 }));
  const runId = await startRun(owner, WS, wf);
  await waitFor(owner, WS, runId, ['waiting']);
  const first = await decideReq(editor, WS, runId, 'approve');
  check('first approval recorded, still waiting (1 of 2)', first.status === 200 && first.body?.status === 'waiting' && first.body?.approvals === 1, JSON.stringify(first.body));
  const dup = await decideReq(editor, WS, runId, 'approve');
  check('the same person approving twice → 409', dup.status === 409, `${dup.status}`);
  let run = await waitFor(owner, WS, runId, ['waiting'], 5);
  check('run still waiting after one of two', run?.status === 'waiting');
  const second = await decideReq(editor2, WS, runId, 'approve');
  check('second approval decides', second.status === 200 && second.body?.status === 'decided', JSON.stringify(second.body));
  run = await waitFor(owner, WS, runId, ['success', 'failed']);
  check('run succeeds with both approvals in the output', run?.status === 'success' && nodeOf(run, 'a')?.output?.approvals?.length === 2);
}

// ------------------------------------------------------------------ G: override, viewer approver, role default
console.log('\nG. who can decide');
{
  const wfViewer = await makeWorkflow(owner, WS, 'Viewer approves', approvalGraph({ assignees: { userIds: [viewer.user.id], roles: [] } }));
  const r1 = await startRun(owner, WS, wfViewer);
  await waitFor(owner, WS, r1, ['waiting']);
  const v = await decideReq(viewer, WS, r1, 'approve');
  check('an assigned viewer can approve', v.status === 200, `${v.status}`);
  check('...and the run completes', (await waitFor(owner, WS, r1, ['success', 'failed']))?.status === 'success');

  const r2 = await startRun(owner, WS, wfViewer);
  await waitFor(owner, WS, r2, ['waiting']);
  const o = await decideReq(admin, WS, r2, 'reject');
  check('an unassigned admin can override (runs:approve_any)', o.status === 200, `${o.status}`);

  const wfRole = await makeWorkflow(owner, WS, 'Admins approve', approvalGraph({ assignees: { userIds: [], roles: ['admin'] } }));
  const r3 = await startRun(owner, WS, wfRole);
  const run3 = await waitFor(owner, WS, r3, ['waiting']);
  check('role assignees resolve to members holding the role', (nodeOf(run3, 'a')?.approval?.assigneeIds || []).map(String).join() === admin.user.id);

  const wfNone = await makeWorkflow(owner, WS, 'Nobody set', approvalGraph({ assignees: { userIds: [], roles: [] } }));
  const r4 = await startRun(owner, WS, wfNone);
  const run4 = await waitFor(owner, WS, r4, ['waiting']);
  const ids = (nodeOf(run4, 'a')?.approval?.assigneeIds || []).map(String).sort();
  check('no assignees → owners and admins', ids.join() === [owner.user.id, admin.user.id].sort().join(), ids.join());
  await req('POST', `/runs/${r3}/cancel`, { token: owner.token, ws: WS });
  await req('POST', `/runs/${r4}/cancel`, { token: owner.token, ws: WS });
}

// ------------------------------------------------------------------ H: signed links
console.log('\nH. signed approve/reject links');
{
  const runId = await startRun(owner, WS, wfMain);
  await waitFor(owner, WS, runId, ['waiting']);
  await sleep(300);
  const outbox = await req('GET', '/outbox', { token: editor.token });
  const msg = (outbox.body || []).find((m) => m.meta?.runId === runId && m.meta?.link);
  check('the assignee has an Outbox message with their link', Boolean(msg), `${outbox.status} ${(outbox.body || []).length} message(s)`);
  const token = String(msg?.meta?.link || '').split('/approve/').pop();
  const page = await req('GET', `/approval-links/${token}`);
  check('GET shows the page without deciding', page.status === 200 && page.body?.status === 'pending' && page.body?.title?.startsWith('Refund'), `${page.status} ${page.body?.status}`);
  check('...the run is still waiting after the GET', (await waitFor(owner, WS, runId, ['waiting'], 3))?.status === 'waiting');
  const tampered = token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA');
  check('a tampered token 404s', (await req('GET', `/approval-links/${tampered}`)).status === 404);
  const post = await req('POST', `/approval-links/${token}`, { body: { decision: 'approve', comment: 'via email' } });
  check('POST decides as the link\'s user', post.status === 200 && post.body?.decision === 'approved', `${post.status} ${JSON.stringify(post.body)}`);
  const run = await waitFor(owner, WS, runId, ['success', 'failed']);
  const approvals = nodeOf(run, 'a')?.output?.approvals || [];
  check('recorded via link, as the assignee', approvals.some((a) => a.userId === editor.user.id && a.via === 'link'));
  const after = await req('GET', `/approval-links/${token}`);
  check('a used link shows "already decided"', after.status === 200 && after.body?.status === 'approved' && after.body?.decidedBy?.id === editor.user.id, JSON.stringify(after.body?.decidedBy));
  const reuse = await req('POST', `/approval-links/${token}`, { body: { decision: 'reject' } });
  check('posting a used link → 409', reuse.status === 409, `${reuse.status}`);

  // A removed member's link stops working.
  const temp = await join(owner, WS, 'editor', 'temp');
  const wfTemp = await makeWorkflow(owner, WS, 'Temp approver', approvalGraph({ assignees: { userIds: [temp.user.id], roles: [] } }));
  const r2 = await startRun(owner, WS, wfTemp);
  await waitFor(owner, WS, r2, ['waiting']);
  await sleep(300);
  const tempMail = (await req('GET', '/outbox', { token: temp.token })).body || [];
  const tempToken = String(tempMail.find((m) => m.meta?.runId === r2)?.meta?.link || '').split('/approve/').pop();
  check('temp member\'s link works before removal', (await req('GET', `/approval-links/${tempToken}`)).status === 200);
  await req('DELETE', `/workspaces/${WS}/members/${temp.user.id}`, { token: owner.token });
  check('...and 404s after they are removed', (await req('GET', `/approval-links/${tempToken}`)).status === 404);
  check('...and cannot decide', (await req('POST', `/approval-links/${tempToken}`, { body: { decision: 'approve' } })).status === 404);
  await req('POST', `/runs/${r2}/cancel`, { token: owner.token, ws: WS });
}

// ------------------------------------------------------------------ I: notifications
console.log('\nI. notifications');
{
  const n = await req('GET', '/notifications', { token: editor.token });
  if (n.status === 404) {
    console.log('  - notifications API not present; skipped');
  } else {
    const list = Array.isArray(n.body) ? n.body : n.body?.notifications || n.body?.items || [];
    check('the assignee received approval_requested notifications', list.some((x) => x.kind === 'approval_requested'), `${n.status} ${list.length}`);
  }
}

// ------------------------------------------------------------------ J: guard + slots
console.log('\nJ. waiting runs block nothing');
{
  const wf = await makeWorkflow(owner, WS, 'Guarded', approvalGraph({ assignees: { userIds: [editor.user.id], roles: [] } }));
  const pub = await req('POST', `/workflows/${wf}/publish`, { token: owner.token, ws: WS, body: { acknowledgeWarnings: true } });
  const first = await startRun(owner, WS, wf);
  await waitFor(owner, WS, first, ['waiting']);
  const second = await startRun(owner, WS, wf);
  check('a second test run starts while the first waits (no 409)', Boolean(second));
  if (ok2xx(pub.status)) {
    await req('POST', `/workflows/${wf}/webhook/regenerate`, { token: owner.token, ws: WS });
    const hookState = await req('PUT', `/workflows/${wf}/webhook`, { token: owner.token, ws: WS, body: { enabled: true } });
    const hookToken = hookState.body?.token;
    const w1 = await fetch(`${B}/hooks/${hookToken}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"amount":1}' });
    const w1Body = await w1.json().catch(() => ({}));
    await waitFor(owner, WS, w1Body.runId, ['waiting']);
    const w2 = await fetch(`${B}/hooks/${hookToken}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"amount":2}' });
    check('a waiting published run doesn\'t block a new webhook run', w1.status === 202 && w2.status === 202, `${w1.status}/${w2.status}`);
    const w2Body = await w2.json().catch(() => ({}));
    for (const id of [w1Body.runId, w2Body.runId]) if (id) await req('POST', `/runs/${id}/cancel`, { token: owner.token, ws: WS });
  } else {
    console.log(`  - publish unavailable (${pub.status}); webhook half skipped`);
  }
  const doc = await db.collection('runs').findOne({ _id: new mongoose.Types.ObjectId(first) });
  check('a parked run holds no queue slot (no node running)', !(doc?.nodeResults || []).some((r) => r.status === 'running' || r.waiting === true));
  for (const id of [first, second]) if (id) await req('POST', `/runs/${id}/cancel`, { token: owner.token, ws: WS });
}

// ------------------------------------------------------------------ K: timeout
console.log('\nK. approval timeout applies the default outcome');
{
  const wf = await makeWorkflow(owner, WS, 'Times out', approvalGraph({ assignees: { userIds: [editor.user.id], roles: [] }, timeout: { afterMs: 1200, outcome: 'approved' } }));
  const runId = await startRun(owner, WS, wf);
  const waiting = await waitFor(owner, WS, runId, ['waiting']);
  check('waiting node carries resumeAt', Boolean(nodeOf(waiting, 'a')?.resumeAt));
  const run = await waitFor(owner, WS, runId, ['success', 'failed'], 60, 150);
  check('timeout decides with the default outcome', run?.status === 'success' && nodeOf(run, 'a')?.output?.decision === 'approved' && nodeOf(run, 'a')?.output?.decidedBy === 'timeout', `${run?.status} ${JSON.stringify(nodeOf(run, 'a')?.output?.decidedBy)}`);
}

// ------------------------------------------------------------------ L: cancel
console.log('\nL. cancelling a waiting run');
{
  const runId = await startRun(owner, WS, wfMain);
  await waitFor(owner, WS, runId, ['waiting']);
  const c = await req('POST', `/runs/${runId}/cancel`, { token: owner.token, ws: WS });
  const run = await waitFor(owner, WS, runId, ['cancelled', 'failed', 'success']);
  check('cancel → cancelled, waiting and pending nodes skipped', c.status === 202 && run?.status === 'cancelled' && nodeOf(run, 'a')?.status === 'skipped' && nodeOf(run, 'yes')?.status === 'skipped', `${c.status} ${run?.status}`);
  const late = await decideReq(editor, WS, runId, 'approve');
  check('deciding a cancelled run\'s approval → 409', late.status === 409, `${late.status}`);
  const audit = await db.collection('auditevents').countDocuments({ workspaceId: new mongoose.Types.ObjectId(WS), action: 'approval.decided' });
  check('decisions are audited (approval.decided)', audit >= 5, `${audit}`);
}

// ------------------------------------------------------------------ N: failure after approval
console.log('\nN. a run that fails after its approval notifies watchers');
{
  const failing = {
    nodes: [
      N('s', 'start', { label: 'Start' }),
      N('a', 'approval', { label: 'Approve', title: 'Go?', assignees: { userIds: [editor.user.id], roles: [] } }),
      N('t', 'tool', { label: 'Breaks', integration: 'builtin', action: 'calculator', params: { expression: '1+1' }, mockOverrides: { failureRate: 1, maxAttempts: 1 } }),
      N('no', 'end', { label: 'Rejected' }),
    ],
    edges: [
      { id: 'e1', source: 's', target: 'a' },
      { id: 'e2', source: 'a', target: 't', sourceHandle: 'approved' },
      { id: 'e3', source: 'a', target: 'no', sourceHandle: 'rejected' },
    ],
  };
  const wf = await makeWorkflow(owner, WS, `Fails after approval ${uniq()}`, failing);
  const runId = await startRun(owner, WS, wf);
  await waitFor(owner, WS, runId, ['waiting']);
  await decideReq(editor, WS, runId, 'approve');
  const run = await waitFor(owner, WS, runId, ['success', 'failed']);
  check('resumed run fails at the node after the approval', run?.status === 'failed' && nodeOf(run, 't')?.status === 'failed', run?.status);
  await sleep(500);
  const n = await req('GET', '/notifications', { token: owner.token });
  if (n.status === 404) {
    console.log('  - notifications API not present; skipped');
  } else {
    const list = Array.isArray(n.body) ? n.body : n.body?.notifications || n.body?.items || [];
    check('the workflow creator (a watcher) got run_failed for the resumed run', list.some((x) => x.kind === 'run_failed' && String(x.link || '').includes(runId)), `${n.status} ${list.map((x) => x.kind).join(',')}`);
  }
}

await mongoose.disconnect();

// ------------------------------------------------------------------ M: restart
console.log('\nM. restart: parked runs survive, timers re-arm, mid-flight runs are interrupted');
{
  const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const port = 4697;
  const restartDb = `${DB_URI.replace(/\/+$/, '')}-approvalsrestart`;
  const env = {
    ...process.env,
    PORT: String(port),
    MONGODB_URI: restartDb,
    INTEGRATIONS_LIVE: 'false',
    DELAY_INLINE_MAX_MS: '500',
    RUN_TIMEOUT_MS: '6000',
    PUBLIC_BASE_URL: `http://localhost:${port}`,
  };
  const conn = await mongoose.createConnection(restartDb).asPromise();
  await conn.dropDatabase();
  let child = null;
  const startServer = async () => {
    child = spawn(process.execPath, ['src/index.js'], { cwd: serverDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(`http://localhost:${port}/api/health`)).ok) return true; } catch { /* not yet */ }
      await sleep(150);
    }
    return false;
  };
  const kill9 = async () => {
    if (!child) return;
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGKILL');
    await exited;
    child = null;
  };

  try {
    check('restart server started', await startServer());
    req = client(`http://localhost:${port}/api`);
    const o = await register('rowner');
    const ws = o.personal;

    const wfApprove = await makeWorkflow(o, ws, 'Survives restart', approvalGraph({ assignees: { userIds: [o.user.id], roles: [] } }));
    const wfTimeout = await makeWorkflow(o, ws, 'Timeout after restart', approvalGraph({ assignees: { userIds: [o.user.id], roles: [] }, timeout: { afterMs: 4000, outcome: 'rejected' } }));
    const wfDelay = await makeWorkflow(o, ws, 'Long delay', {
      nodes: [N('s', 'start', { label: 'Start' }), N('d', 'delay', { label: 'Wait', mode: 'duration', durationMs: 3500 }), N('e', 'end', { label: 'End' })],
      edges: [{ id: 'e1', source: 's', target: 'd' }, { id: 'e2', source: 'd', target: 'e' }],
    });
    const wfSlow = await makeWorkflow(o, ws, 'Mid-flight', {
      nodes: [
        N('s', 'start', { label: 'Start' }),
        N('t', 'tool', { label: 'Slow', integration: 'builtin', action: 'calculator', params: { expression: '2+2' }, mockOverrides: { failureRate: 0, latencyMs: [4000, 4000] } }),
        N('e', 'end', { label: 'End' }),
      ],
      edges: [{ id: 'e1', source: 's', target: 't' }, { id: 'e2', source: 't', target: 'e' }],
    });

    const rApprove = await startRun(o, ws, wfApprove);
    const rTimeout = await startRun(o, ws, wfTimeout);
    const rDelay = await startRun(o, ws, wfDelay);
    const parkedApprove = await waitFor(o, ws, rApprove, ['waiting']);
    await waitFor(o, ws, rTimeout, ['waiting']);
    const parkedDelay = await waitFor(o, ws, rDelay, ['waiting']);
    check('approval run parked before the restart', parkedApprove?.status === 'waiting');
    check('long delay parked with resumeAt (over DELAY_INLINE_MAX_MS)', parkedDelay?.status === 'waiting' && Boolean(nodeOf(parkedDelay, 'd')?.resumeAt));
    const rSlow = await startRun(o, ws, wfSlow);
    await waitFor(o, ws, rSlow, ['running']);
    await sleep(600);

    await kill9();
    check('server restarted after kill -9', await startServer());

    const slow = await waitFor(o, ws, rSlow, ['failed', 'success'], 20);
    check('mid-flight run reconciled as failed / interrupted', slow?.status === 'failed' && slow?.failReason === 'interrupted', `${slow?.status} ${slow?.failReason}`);
    check('...with no node left running or pending', !(slow?.nodeResults || []).some((r) => ['running', 'pending'].includes(r.status)));
    check('...and the running node logs the restart', (nodeOf(slow, 't')?.logs || []).some((l) => /server restarted/.test(l)));

    const still = await req('GET', `/runs/${rApprove}`, { token: o.token, ws });
    check('parked approval run is still waiting after the restart', still.body?.status === 'waiting', still.body?.status);
    // Wall time since the run started is now well past RUN_TIMEOUT_MS (6 s)...
    await sleep(Math.max(0, 6500 - (Date.now() - new Date(still.body?.startedAt || Date.now()).getTime())));
    const d = await req('POST', `/runs/${rApprove}/approvals/a`, { token: o.token, ws, body: { decision: 'approve' } });
    check('approving after the restart → 200', d.status === 200, `${d.status} ${d.body?.error}`);
    const done = await waitFor(o, ws, rApprove, ['success', 'failed']);
    check('...and the run completes on the pre-restart upstream outputs', done?.status === 'success' && nodeOf(done, 'yes')?.status === 'success', `${done?.status} ${done?.failReason}`);
    check('waiting time did not count toward RUN_TIMEOUT_MS (6 s)', done?.failReason !== 'timeout' && done?.status === 'success');

    const t = await waitFor(o, ws, rTimeout, ['success', 'failed'], 60, 200);
    check('approval timeout re-armed after restart fires the default outcome', t?.status === 'success' && nodeOf(t, 'a')?.output?.decidedBy === 'timeout' && nodeOf(t, 'no')?.status === 'success', `${t?.status}`);
    const dl = await waitFor(o, ws, rDelay, ['success', 'failed'], 60, 200);
    check('parked delay re-armed after restart resumes and completes', dl?.status === 'success' && nodeOf(dl, 'e')?.status === 'success', `${dl?.status}`);
  } finally {
    await kill9();
    await conn.dropDatabase().catch(() => {});
    await conn.close();
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
