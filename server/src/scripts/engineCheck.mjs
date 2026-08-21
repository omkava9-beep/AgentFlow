/**
 * Engine check for spec/19 - the acceptance criteria as a runnable script.
 *
 *   npm run check:engine
 *
 * Uses a throwaway database (your MONGODB_URI with an `-enginecheck` suffix) so
 * it can never touch dev data, and drops it on the way out. Override the run
 * deadline and pool size to exercise the timeout and concurrency paths:
 *
 *   QUEUE_CONCURRENCY=2 RUN_TIMEOUT_MS=300 npm run check:engine
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { executeRun, requestCancel } from '../engine/executeRun.js';
import Run from '../models/Run.js';
import { queue } from '../queue/index.js';
import { toolCache } from '../cache/TTLCache.js';

const CHECK_DB_URI = `${env.mongodbUri.replace(/\/+$/, '')}-enginecheck`;

const OWNER = new mongoose.Types.ObjectId();
const WF = new mongoose.Types.ObjectId();

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

const node = (id, type, config = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { config } });
const edge = (source, target, extra = {}) => ({ id: `e-${source}-${target}-${extra.sourceHandle || extra.label || ''}`, source, target, ...extra });
const tool = (id, toolType, over = {}) => node(id, 'tool', { label: id, toolType, mockOverrides: { failureRate: 0, latencyMs: [60, 90], ...over } });

async function run(workflow) {
  toolCache.clear();
  const doc = await Run.create({ workflowId: WF, ownerId: OWNER, status: 'pending' });
  const id = doc._id.toString();
  let peakActive = 0;
  const onStats = (s) => { peakActive = Math.max(peakActive, s.active); };
  queue.on('stats', onStats);
  const finished = await executeRun(id, workflow);
  queue.off('stats', onStats);
  const byId = Object.fromEntries(finished.nodeResults.map((r) => [r.nodeId, r]));
  return { runDoc: finished, byId, peakActive, id };
}

await mongoose.connect(CHECK_DB_URI);
console.log(`engine check · concurrency=${queue.concurrency} · runTimeoutMs=${env.runTimeoutMs}\n`);

// ---------------------------------------------------------------- A: fan-out
console.log('A. concurrent fan-out (start -> 4 tools)');
{
  const wf = {
    nodes: [node('s', 'start'), tool('t1', 'fake-weather'), tool('t2', 'calculator'), tool('t3', 'fake-search'), tool('t4', 'fake-weather')],
    edges: [edge('s', 't1'), edge('s', 't2'), edge('s', 't3'), edge('s', 't4')],
  };
  const { byId, peakActive } = await run(wf);
  check(`peak queue active = ${peakActive} (expect ${Math.min(4, queue.concurrency)})`, peakActive === Math.min(4, queue.concurrency));
  check('all four tools succeeded', ['t1','t2','t3','t4'].every((k) => byId[k].status === 'success'));
}

// ---------------------------------------------------- C: diamond / fan-in join
console.log('\nC. diamond — condition -> A/B -> join');
{
  const wf = {
    nodes: [node('s', 'start'), node('c', 'condition', { expression: 'true' }), tool('a', 'fake-weather'), tool('b', 'calculator'), node('j', 'end')],
    edges: [edge('s', 'c'), edge('c', 'a', { sourceHandle: 'true', label: 'true' }), edge('c', 'b', { sourceHandle: 'false', label: 'false' }), edge('a', 'j'), edge('b', 'j')],
  };
  const { runDoc, byId } = await run(wf);
  check('taken branch A succeeded', byId.a.status === 'success', byId.a.status);
  check('untaken branch B skipped', byId.b.status === 'skipped', byId.b.status);
  check('JOIN NODE RAN (not skipped)', byId.j.status === 'success', `got '${byId.j.status}'`);
  check('run succeeded', runDoc.status === 'success', runDoc.status);
}

// ------------------------------------------------- D: keyed fan-in input shape
console.log('\nD. keyed fan-in input shape (2 tools -> end)');
{
  const wf = {
    nodes: [node('s', 'start'), tool('t1', 'fake-weather'), tool('t2', 'calculator'), node('e', 'end')],
    edges: [edge('s', 't1'), edge('s', 't2'), edge('t1', 'e'), edge('t2', 'e')],
  };
  const { byId } = await run(wf);
  const out = byId.e.output;
  const keys = out && typeof out === 'object' ? Object.keys(out).sort() : [];
  check('end input keyed by source node id', JSON.stringify(keys) === '["t1","t2"]', JSON.stringify(keys));
  check('not a positional array', !Array.isArray(out));
}

// ------------------------------------------- E: failure injection + per-node retry
console.log('\nE. failureRate 1.0 + maxAttempts 5');
{
  const wf = {
    nodes: [node('s', 'start'), tool('bad', 'fake-weather', { failureRate: 1, maxAttempts: 5, latencyMs: [5, 10] }), node('after', 'end')],
    edges: [edge('s', 'bad'), edge('bad', 'after')],
  };
  const { runDoc, byId } = await run(wf);
  check('node failed', byId.bad.status === 'failed', byId.bad.status);
  check(`attempts = ${byId.bad.attempts} (expect 5)`, byId.bad.attempts === 5);
  check('retry log lines present', byId.bad.logs.some((l) => l.includes('retrying in')), `${byId.bad.logs.length} logs`);
  check('simulated-failure phrasing kept', byId.bad.logs.some((l) => l.includes('[simulated failure]')));
  check('downstream skipped', byId.after.status === 'skipped', byId.after.status);
  check('run failed', runDoc.status === 'failed', runDoc.status);
  check('no node left pending', runDoc.nodeResults.every((r) => r.status !== 'pending'));
}

// ------------------------------------------------------- E2: unknown tool type
console.log('\nE2. unknown tool type fails immediately (permanent, not retried)');
{
  const wf = {
    nodes: [node('s', 'start'), tool('u', 'does-not-exist')],
    edges: [edge('s', 'u')],
  };
  const { byId } = await run(wf);
  check('failed', byId.u.status === 'failed', byId.u.status);
  check(`attempts = ${byId.u.attempts} (expect 1, no wasted retries)`, byId.u.attempts === 1);
}

// ---------------------------------------------------------------- F: cancellation
console.log('\nF. cancellation mid-run');
{
  const wf = {
    nodes: [node('s', 'start'), tool('slow1', 'fake-weather', { latencyMs: [400, 450] }), tool('slow2', 'calculator', { latencyMs: [400, 450] }), node('never', 'end')],
    edges: [edge('s', 'slow1'), edge('slow1', 'slow2'), edge('slow2', 'never')],
  };
  toolCache.clear();
  const doc = await Run.create({ workflowId: WF, ownerId: OWNER, status: 'pending' });
  const id = doc._id.toString();
  const p = executeRun(id, wf);
  await new Promise((r) => setTimeout(r, 250));
  const accepted = requestCancel(id);
  const finished = await p;
  const byId = Object.fromEntries(finished.nodeResults.map((r) => [r.nodeId, r]));
  check('cancel request accepted', accepted === true);
  check("status = 'cancelled'", finished.status === 'cancelled', finished.status);
  check("cancelReason = 'user'", finished.cancelReason === 'user', String(finished.cancelReason));
  check('in-flight node kept its real result', byId.slow1.status === 'success', byId.slow1.status);
  check('unreached nodes skipped', byId.slow2.status === 'skipped' && byId.never.status === 'skipped', `${byId.slow2.status}/${byId.never.status}`);
  check('no node left pending', finished.nodeResults.every((r) => r.status !== 'pending'));
}

// ---------------------------------------------------------------------- G: cycle
console.log('\nG. cyclic graph fails loudly instead of hanging');
{
  const wf = {
    nodes: [node('s', 'start'), tool('x', 'fake-weather'), tool('y', 'calculator')],
    edges: [edge('s', 'x'), edge('x', 'y'), edge('y', 'x')],
  };
  const { runDoc, byId } = await run(wf);
  check('run failed', runDoc.status === 'failed', runDoc.status);
  check('cycle nodes failed, not pending', byId.x.status === 'failed' && byId.y.status === 'failed', `${byId.x.status}/${byId.y.status}`);
  check('explanatory log', byId.x.logs.some((l) => l.includes('cycle')));
}

// -------------------------------------------------------------------- H: timeout
console.log(`\nH. run timeout (runTimeoutMs=${env.runTimeoutMs})`);
if (env.runTimeoutMs > 2000) {
  console.log('  - skipped: rerun with RUN_TIMEOUT_MS=300 to exercise the deadline');
} else {
  const wf = {
    nodes: [node('s', 'start'), tool('slow', 'fake-weather', { latencyMs: [500, 550] }), node('e', 'end')],
    edges: [edge('s', 'slow'), edge('slow', 'e')],
  };
  const { runDoc, byId } = await run(wf);
  check("status = 'failed' (NOT success)", runDoc.status === 'failed', runDoc.status);
  check("cancelReason = 'timeout'", runDoc.cancelReason === 'timeout', String(runDoc.cancelReason));
  check('no node left pending', runDoc.nodeResults.every((r) => r.status !== 'pending'), runDoc.nodeResults.map((r) => `${r.nodeId}:${r.status}`).join(' '));
  check('unreached node skipped', byId.e.status === 'skipped', byId.e.status);
}

// ------------------------------------------------------------------ I: queue health
console.log('\nI. queue health after all of the above');
{
  const s = queue.stats();
  check(`active = ${s.active} (expect 0)`, s.active === 0);
  check(`queued = ${s.queued} (expect 0)`, s.queued === 0);
  check('activeCount never went negative', queue.activeCount >= 0, String(queue.activeCount));
}

await mongoose.connection.dropDatabase();
await mongoose.disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
