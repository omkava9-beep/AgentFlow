/**
 * Fair queue, plans and quotas (spec/33) - the acceptance criteria as a script.
 *
 *   npm run check:queue
 *
 * Sections A-H drive InProcessQueue directly (no server, no database). I-J use a
 * throwaway database (`<MONGODB_URI>-queuecheck`) for the quota race and usage
 * flush. K runs over HTTP against a running server (BASE, default
 * http://localhost:4500/api) sharing MONGODB_URI, for 429s, plan changes and the
 * member limit.
 *
 * Not covered here yet: the nested sub-workflow (spec/31) and agent-with-tools
 * (spec/37) deadlock criteria - those node types don't exist yet; their specs'
 * checks add them.
 */
import mongoose from 'mongoose';
import { InProcessQueue, SYSTEM_KEY } from '../queue/InProcessQueue.js';
import { PermanentFailure } from '../queue/errors.js';

const BASE = process.env.BASE || 'http://localhost:4500/api';
const DB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/agent-orchestration';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A job that records when it started/finished, optionally failing its first N attempts. */
function job(log, tag, { ms = 20, failTimes = 0, retryAfterMs, permanent = false, hooks = {} } = {}) {
  let attempts = 0;
  return {
    payload: null,
    ...hooks,
    run: async () => {
      attempts += 1;
      log.push({ tag, event: 'start', at: Date.now(), attempt: attempts });
      await sleep(ms);
      if (attempts <= failTimes) {
        log.push({ tag, event: 'fail', at: Date.now(), attempt: attempts });
        const err = permanent ? new PermanentFailure(`${tag} permanent`) : new Error(`${tag} flaky`);
        if (retryAfterMs) err.retryAfterMs = retryAfterMs;
        throw err;
      }
      log.push({ tag, event: 'done', at: Date.now(), attempt: attempts });
      return tag;
    },
  };
}

/** Tracks peak concurrent active jobs per workspace via the job hooks. */
function peakTracker() {
  const active = new Map();
  const peak = new Map();
  const wrap = (ws, j) => {
    const run = j.run;
    return {
      ...j,
      run: async (p) => {
        active.set(ws, (active.get(ws) || 0) + 1);
        peak.set(ws, Math.max(peak.get(ws) || 0, active.get(ws)));
        try { return await run(p); } finally { active.set(ws, active.get(ws) - 1); }
      },
    };
  };
  return { wrap, peak };
}

// ---------------------------------------------------------------- A: fairness
console.log('A. round-robin across workspaces (pool 8, no caps)');
{
  const q = new InProcessQueue({ concurrency: 8, baseBackoffMs: 10, capFor: () => Infinity });
  const log = [];
  const aDone = [];
  for (let i = 0; i < 60; i += 1) aDone.push(q.enqueue(job(log, `A${i}`, { ms: 25 }), { meta: { workspaceId: 'wsA' } }));
  await sleep(5);
  const bEnqueuedAt = Date.now();
  const bDone = [];
  for (let i = 0; i < 4; i += 1) bDone.push(q.enqueue(job(log, `B${i}`, { ms: 10 }), { meta: { workspaceId: 'wsB' } }));
  await Promise.all(bDone);
  const aQueuedWhenBFinished = q.statsFor('wsA').queued;
  const startsAfterB = log.filter((e) => e.event === 'start' && e.at >= bEnqueuedAt);
  const firstAfter = startsAfterB[0]?.tag || '';
  check("B's first job is the next job started after B enqueues", firstAfter.startsWith('B'), `first start after B: ${firstAfter}`);
  check('all of B finished while A still had > 40 queued', aQueuedWhenBFinished > 40, `A queued: ${aQueuedWhenBFinished}`);
  await Promise.all(aDone);
  check('every A job still completes', log.filter((e) => e.event === 'done' && e.tag.startsWith('A')).length === 60);
}

// ---------------------------------------------------------------- B: caps
console.log('\nB. per-workspace caps (pool 8)');
{
  const caps = { free: 2, team: 4 };
  const q = new InProcessQueue({ concurrency: 8, capFor: (ws) => caps[ws] });
  const { wrap, peak } = peakTracker();
  const log = [];
  const all = [];
  for (let i = 0; i < 10; i += 1) all.push(q.enqueue(wrap('free', job(log, `F${i}`, { ms: 30 })), { meta: { workspaceId: 'free' } }));
  await sleep(10);
  const busy = q.stats();
  check('a capped workspace leaves pool slots idle rather than exceed its cap', busy.active === 2, `pool active ${busy.active}/8`);
  for (let i = 0; i < 10; i += 1) all.push(q.enqueue(wrap('team', job(log, `T${i}`, { ms: 30 })), { meta: { workspaceId: 'team' } }));
  await Promise.all(all);
  check('Free workspace never exceeds 2 active jobs', peak.get('free') === 2, `peak ${peak.get('free')}`);
  check('Team workspace never exceeds 4 active jobs', peak.get('team') === 4, `peak ${peak.get('team')}`);
  const s = q.statsFor('free');
  check('statsFor carries cap, concurrency and poolSaturated', s.cap === 2 && s.concurrency === 8 && s.poolSaturated === false, JSON.stringify(s));
  const unknownCap = new InProcessQueue({ concurrency: 3, capFor: () => 99 }).statsFor('x').cap;
  check('a cap is never reported above the pool size', unknownCap === 3, `cap ${unknownCap}`);
}

// ---------------------------------------------------------------- C: __system__
console.log('\nC. jobs without a workspace use the uncapped __system__ subqueue');
{
  const q = new InProcessQueue({ concurrency: 8, capFor: () => 1 });
  const { wrap, peak } = peakTracker();
  const log = [];
  await Promise.all(Array.from({ length: 6 }, (_, i) => q.enqueue(wrap(SYSTEM_KEY, job(log, `S${i}`, { ms: 30 })))));
  check('six system jobs run six-wide even though every tenant cap is 1', peak.get(SYSTEM_KEY) === 6, `peak ${peak.get(SYSTEM_KEY)}`);
  // The engine check listens to the global 'stats' event for its concurrency bound.
  let sawGlobal = false;
  q.on('stats', (st) => { if (st.active >= 1 && 'queued' in st && 'concurrency' in st) sawGlobal = true; });
  await q.enqueue(job(log, 'S-last'));
  check("global 'stats' event keeps its { active, queued, concurrency } shape", sawGlobal);
}

// ---------------------------------------------------------------- D: backoff
console.log("\nD. retry backoff holds neither a pool slot nor the workspace's cap");
{
  const q = new InProcessQueue({ concurrency: 1, baseBackoffMs: 200, capFor: () => 1 });
  const log = [];
  const flaky = q.enqueue(job(log, 'flaky', { ms: 10, failTimes: 1 }), { maxAttempts: 3, meta: { workspaceId: 'ws' } });
  await sleep(40); // flaky's first attempt has failed and it's in backoff now
  const during = q.statsFor('ws');
  check('during backoff the workspace has 0 active jobs', during.active === 0, JSON.stringify(during));
  const quick = q.enqueue(job(log, 'quick', { ms: 10 }), { meta: { workspaceId: 'ws' } });
  await quick;
  const quickDone = log.find((e) => e.tag === 'quick' && e.event === 'done').at;
  const res = await flaky;
  const retryStart = log.find((e) => e.tag === 'flaky' && e.event === 'start' && e.attempt === 2).at;
  check('a job enqueued during the backoff completes before the retry starts', quickDone < retryStart);
  check('the retried job resolves with attempts = 2', res.attempts === 2 && res.result === 'flaky', JSON.stringify(res));
  check('resolved value keeps { result, attempts } and adds queuedMs', 'queuedMs' in res && Number.isFinite(res.queuedMs));

  const perm = q.enqueue(job(log, 'perm', { ms: 5, failTimes: 5, permanent: true }), { maxAttempts: 5, meta: { workspaceId: 'ws' } });
  const err = await perm.catch((e) => e);
  check('a PermanentFailure is not retried', err?.attempts === 1, `attempts ${err?.attempts}`);
}

// ---------------------------------------------------------------- E: Retry-After
console.log('\nE. Retry-After from a live integration lengthens the backoff (max 30 s)');
{
  const q = new InProcessQueue({ concurrency: 2, baseBackoffMs: 10 });
  const log = [];
  const r = await q.enqueue(job(log, 'ra', { ms: 5, failTimes: 1, retryAfterMs: 300 }), { maxAttempts: 2 });
  const failedAt = log.find((e) => e.tag === 'ra' && e.event === 'fail').at;
  const retriedAt = log.find((e) => e.tag === 'ra' && e.event === 'start' && e.attempt === 2).at;
  check('retry waited for Retry-After (≥ ~300 ms) instead of the 10 ms backoff', retriedAt - failedAt >= 280, `${retriedAt - failedAt} ms`);
  check('and then succeeded', r.attempts === 2);

  let capped = null;
  q.on('job:retrying', (info) => { if (info.error.startsWith('huge')) capped = info.backoff; });
  q.enqueue(job(log, 'huge', { ms: 1, failTimes: 1, retryAfterMs: 120_000 }), { maxAttempts: 2 }).catch(() => {});
  await sleep(30);
  check('a huge Retry-After is capped at 30 000 ms', capped === 30_000, `backoff ${capped}`);
}

// ---------------------------------------------------------------- F: wait hooks
console.log('\nF. waiting nodes: onWait reason and queuedMs');
{
  const q = new InProcessQueue({ concurrency: 2, capFor: () => 1 });
  const log = [];
  const waits = [];
  const starts = [];
  const hooks = (tag) => ({ onWait: (w) => waits.push({ tag, ...w }), onStart: (s) => starts.push({ tag, ...s }) });
  const a = q.enqueue(job(log, 'a1', { ms: 60, hooks: hooks('a1') }), { meta: { workspaceId: 'A' } });
  const b = q.enqueue(job(log, 'a2', { ms: 10, hooks: hooks('a2') }), { meta: { workspaceId: 'A' } });
  check('the first job starts at once (no onWait)', !waits.some((w) => w.tag === 'a1'));
  check("a job blocked by its workspace's cap waits with reason 'cap'", waits.find((w) => w.tag === 'a2')?.reason === 'cap', JSON.stringify(waits));
  await Promise.all([a, b]);
  const s2 = starts.find((s) => s.tag === 'a2');
  check('onStart reports queuedMs for the waiting job', s2 && s2.queuedMs >= 40, `queuedMs ${s2?.queuedMs}`);

  const pool = new InProcessQueue({ concurrency: 1, capFor: () => 5 });
  const w2 = [];
  const p1 = pool.enqueue(job(log, 'x', { ms: 30 }), { meta: { workspaceId: 'X' } });
  const p2 = pool.enqueue(job(log, 'y', { ms: 5, hooks: { onWait: (w) => w2.push(w) } }), { meta: { workspaceId: 'Y' } });
  check("a job blocked only by a full pool waits with reason 'pool'", w2[0]?.reason === 'pool', JSON.stringify(w2));
  check('poolSaturated is true while the pool is full', pool.statsFor('Y').poolSaturated === true);
  await Promise.all([p1, p2]);
}

// ---------------------------------------------------------------- G: live cap change
console.log('\nG. a plan change applies on the next dispatch');
{
  let cap = 1;
  const q = new InProcessQueue({ concurrency: 8, capFor: () => cap });
  const log = [];
  const jobs = Array.from({ length: 4 }, (_, i) => q.enqueue(job(log, `g${i}`, { ms: 80 }), { meta: { workspaceId: 'G' } }));
  await sleep(10);
  check('cap 1: one job running', q.statsFor('G').active === 1);
  cap = 3;
  q.capsChanged('G');
  check('raising the cap starts queued jobs immediately', q.statsFor('G').active === 3, JSON.stringify(q.statsFor('G')));
  cap = 1;
  q.capsChanged('G');
  check('lowering the cap never kills running jobs', q.statsFor('G').active === 3);
  await Promise.all(jobs);
}

// ---------------------------------------------------------------- H: stats events
console.log("\nH. 'workspace-stats' events carry only their own workspace's numbers");
{
  const q = new InProcessQueue({ concurrency: 4, capFor: () => 2 });
  const events = [];
  q.on('workspace-stats', (e) => events.push(e));
  const log = [];
  await Promise.all([
    q.enqueue(job(log, 'h1', { ms: 20 }), { meta: { workspaceId: 'H1' } }),
    q.enqueue(job(log, 'h2', { ms: 20 }), { meta: { workspaceId: 'H2' } }),
    q.enqueue(job(log, 'hs', { ms: 20 })),
  ]);
  const keys = new Set(events.map((e) => e.workspaceId));
  check('events exist for both tenants and never for __system__', keys.has('H1') && keys.has('H2') && !keys.has(SYSTEM_KEY), [...keys].join(','));
  check('every event has { active, queued, cap, concurrency, poolSaturated }', events.every((e) => ['active', 'queued', 'cap', 'concurrency', 'poolSaturated'].every((k) => k in e)));
  const last = (ws) => [...events].reverse().find((e) => e.workspaceId === ws);
  check('each tenant ends on a final idle report', last('H1').active === 0 && last('H1').queued === 0 && last('H2').active === 0);
}

// ---------------------------------------------------------------- I/J: database
console.log('\nI. daily run quota: atomic reservation');
const CHECK_DB = `${DB_URI.replace(/\/+$/, '')}-queuecheck`;
const conn = await mongoose.connect(CHECK_DB);
const { default: UsageCounter } = await import('../models/UsageCounter.js');
const { default: Workspace } = await import('../models/Workspace.js');
const { reserveRun } = await import('../services/quota.js');
const { recordUsage, flushUsage, getUsage, utcDay, nextUtcMidnight } = await import('../services/usage.js');
{
  await UsageCounter.syncIndexes();
  const ws = await Workspace.create({ name: 'Quota Co', slug: `quota-${Date.now()}`, plan: 'free' });
  await UsageCounter.create({ workspaceId: ws._id, day: utcDay(), runs: 99 });
  const results = await Promise.all([reserveRun(ws._id, 'free'), reserveRun(ws._id, 'free')]);
  const okCount = results.filter((r) => r.ok).length;
  check('two concurrent reservations at limit - 1: exactly one wins', okCount === 1, JSON.stringify(results.map((r) => r.ok)));
  const again = await reserveRun(ws._id, 'free');
  check('at the limit: refused with limit and resetAt', !again.ok && again.limit === 100 && +new Date(again.resetAt) === +nextUtcMidnight(), JSON.stringify(again));
  const doc = await UsageCounter.findOne({ workspaceId: ws._id, day: utcDay() });
  check('the counter stops exactly at the limit', doc.runs === 100, `runs ${doc.runs}`);
  const fresh = await Workspace.create({ name: 'Fresh', slug: `fresh-${Date.now()}` });
  const first = await Promise.all(Array.from({ length: 5 }, () => reserveRun(fresh._id, 'free')));
  check('first runs of the day racing on the upsert all succeed', first.every((r) => r.ok), JSON.stringify(first.map((r) => r.ok)));
  const ent = await reserveRun(fresh._id, 'enterprise');
  check('enterprise has no daily limit but still counts runs', ent.ok && (await UsageCounter.findOne({ workspaceId: fresh._id, day: utcDay() })).runs === 6);

  console.log('\nJ. usage metering: accumulate, flush, series');
  recordUsage(ws._id, { nodeExecutions: 3, integrationCalls: { live: 2 }, 'integrationCalls.sandbox': 1, bogus: 5 });
  recordUsage(ws._id, { cacheHits: 1, cacheMisses: 2 });
  recordUsage(null, { nodeExecutions: 100 });
  const pre = (await getUsage(ws._id, { days: 30 })).at(-1);
  check('unflushed counts already show in the series', pre.nodeExecutions === 3 && pre.integrationCalls.live === 2);
  await flushUsage();
  const after = await UsageCounter.findOne({ workspaceId: ws._id, day: utcDay() }).lean();
  check('flush $incs the day counter', after.nodeExecutions === 3 && after.integrationCalls.live === 2 && after.integrationCalls.sandbox === 1 && after.cacheMisses === 2, JSON.stringify(after));
  check('unknown counter paths are dropped, not stored', !('bogus' in after));
  const series = await getUsage(ws._id, { days: 30 });
  check('series has 30 days, oldest first, today last', series.length === 30 && series.at(-1).day === utcDay() && series[0].day < series.at(-1).day);
  check('a second flush with nothing pending writes nothing', (await flushUsage()) === 0);
}
await conn.connection.dropDatabase();
await mongoose.disconnect();

// ---------------------------------------------------------------- K: HTTP
console.log('\nK. over HTTP: 429s, plan changes, member limit');
async function api(method, path, { token, ws, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...(ws && { 'X-Workspace-Id': ws }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
}
const up = await fetch(`${BASE}/health`).then((r) => r.ok).catch(() => false);
check(`server reachable at ${BASE}`, up);
if (up) {
  await mongoose.connect(DB_URI);
  const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const reg = async (tag) => (await api('POST', '/auth/register', { body: { email: `${tag}${uniq()}@queue.dev`, password: 'password123' } })).body;
  const owner = await reg('owner');
  const ws = (await api('POST', '/workspaces', { token: owner.token, body: { name: `Quota ${uniq()}` } })).body;
  const W = ws.id;
  const N = (id, type) => ({ id, type, position: { x: 0, y: 0 }, data: { config: { label: id } } });
  const wf = (await api('POST', '/workflows', { token: owner.token, ws: W, body: { name: 'q' } })).body;
  await api('PUT', `/workflows/${wf._id}`, { token: owner.token, ws: W, body: { nodes: [N('s', 'start'), N('e', 'end')], edges: [{ id: 'e1', source: 's', target: 'e' }] } });
  // spec/30: webhook, API and event runs execute the published version.
  await api('POST', `/workflows/${wf._id}/publish`, { token: owner.token, ws: W, body: { acknowledgeWarnings: true } });
  const empty = (await api('POST', '/workflows', { token: owner.token, ws: W, body: { name: 'empty' } })).body;

  const plans = await api('GET', '/plans', { token: owner.token });
  check('GET /api/plans lists free/team/enterprise with limits only', plans.status === 200 && plans.body.map((p) => p.id).join() === 'free,team,enterprise' && !JSON.stringify(plans.body).includes('price'));

  const counters = mongoose.connection.collection('usagecounters');
  const setRuns = (n) => counters.updateOne({ workspaceId: new mongoose.Types.ObjectId(W), day: utcDay() }, { $set: { runs: n } }, { upsert: true });
  await setRuns(100);

  const notRunnable = await api('POST', `/workflows/${empty._id}/runs`, { token: owner.token, ws: W });
  const afterReject = (await counters.findOne({ workspaceId: new mongoose.Types.ObjectId(W), day: utcDay() })).runs;
  check('a not-runnable request is rejected before quota (400) and uses none', notRunnable.status === 400 && afterReject === 100, `${notRunnable.status} runs=${afterReject}`);

  const manual = await api('POST', `/workflows/${wf._id}/runs`, { token: owner.token, ws: W });
  check('manual run at quota → 429 with limit and resetAt', manual.status === 429 && manual.body?.limit === 100 && Boolean(manual.body?.resetAt), `${manual.status} ${JSON.stringify(manual.body)}`);
  check('429 carries a Retry-After header', Number(manual.headers.get('retry-after')) > 0, manual.headers.get('retry-after'));
  check('message names the plan', /Free plan/.test(manual.body?.error || ''), manual.body?.error);

  const hook = await api('POST', `/workflows/${wf._id}/webhook/regenerate`, { token: owner.token, ws: W });
  await api('PUT', `/workflows/${wf._id}/webhook`, { token: owner.token, ws: W, body: { enabled: true } });
  const viaHook = await api('POST', `/hooks/${hook.body?.token}`, { body: {} });
  check('webhook at quota → 429', viaHook.status === 429, `${viaHook.status}`);

  const key = (await api('POST', `/workspaces/${W}/api-keys`, { token: owner.token, body: { name: 'q', scopes: ['events:publish', 'runs:create'] } })).body?.key;
  const pub = await fetch(`${BASE}/w/${ws.slug}/workflows/${wf._id}/runs`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{}' });
  check('public API run at quota → 429', pub.status === 429, `${pub.status}`);

  await api('PUT', `/workflows/${wf._id}/event-trigger`, { token: owner.token, ws: W, body: { eventName: 'quota.test', enabled: true } });
  const ev = await fetch(`${BASE}/w/${ws.slug}/events/quota.test`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{}' });
  const evBody = await ev.json().catch(() => null);
  check('event publish at quota → still 202, subscriber skipped with quota-exceeded', ev.status === 202 && evBody?.triggered?.length === 0 && evBody?.skipped?.[0]?.reason === 'quota-exceeded', `${ev.status} ${JSON.stringify(evBody)}`);

  // A second member, to prove only owners change plans.
  const adminUser = await reg('admin');
  const me = await api('GET', '/auth/me', { token: adminUser.token });
  const inv = await api('POST', `/workspaces/${W}/invitations`, { token: owner.token, body: { email: me.body.email, role: 'admin' } });
  await api('POST', `/invitations/${inv.body?.inviteUrl?.split('/invite/').pop()}/accept`, { token: adminUser.token });
  const byAdmin = await api('PATCH', `/workspaces/${W}/plan`, { token: adminUser.token, body: { plan: 'team' } });
  check('an admin cannot change the plan (403)', byAdmin.status === 403, `${byAdmin.status}`);
  const bad = await api('PATCH', `/workspaces/${W}/plan`, { token: owner.token, body: { plan: 'platinum' } });
  check('an unknown plan is rejected (400)', bad.status === 400, `${bad.status}`);
  const toTeam = await api('PATCH', `/workspaces/${W}/plan`, { token: owner.token, body: { plan: 'team' } });
  check('the owner switches to Team', toTeam.status === 200 && toTeam.body?.plan === 'team', `${toTeam.status} ${toTeam.body?.plan}`);
  const runNow = await api('POST', `/workflows/${wf._id}/runs`, { token: owner.token, ws: W });
  check('the higher quota applies at once: the run starts', runNow.status === 202, `${runNow.status} ${JSON.stringify(runNow.body)}`);

  const usage = await api('GET', `/workspaces/${W}/usage?days=14`, { token: adminUser.token });
  const u = usage.body || {};
  check('GET usage: plan, limits, today, members, live, series', usage.status === 200 && u.plan?.id === 'team' && u.limits?.runsPerDay === 2000 && u.today?.runs === 101 && u.members?.used === 2 && u.series?.length === 14 && 'cap' in (u.live || {}), JSON.stringify({ status: usage.status, plan: u.plan?.id, today: u.today?.runs, members: u.members, len: u.series?.length }));
  check('usage reports the Team cap (bounded by the pool)', u.live?.cap === Math.min(4, u.limits?.pool), `cap ${u.live?.cap} pool ${u.limits?.pool}`);

  // Member limit: Free allows 5 including pending invites. owner + admin = 2.
  await api('PATCH', `/workspaces/${W}/plan`, { token: owner.token, body: { plan: 'free' } });
  const results = [];
  for (let i = 0; i < 4; i += 1) {
    results.push((await api('POST', `/workspaces/${W}/invitations`, { token: owner.token, body: { email: `seat${i}${uniq()}@queue.dev`, role: 'viewer' } })).status);
  }
  check('invites up to the Free limit of 5 seats succeed, the next is 403', results.slice(0, 3).every((s) => s === 201) && results[3] === 403, results.join(','));
  const over = await api('POST', `/workspaces/${W}/invitations`, { token: owner.token, body: { email: `over${uniq()}@queue.dev`, role: 'viewer' } });
  check('the 403 names the plan limit', over.status === 403 && /Free plan allows 5 members/.test(over.body?.error || ''), over.body?.error);
  await mongoose.disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
