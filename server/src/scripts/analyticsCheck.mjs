/**
 * Analytics check for spec/14. Needs a running server on the SAME database:
 *
 *   MONGODB_URI=...-analyticscheck PORT=4700 npm run dev          # terminal 1
 *   BASE=http://localhost:4700/api MONGODB_URI=... npm run check:analytics
 *
 * Seeds runs directly through Mongoose so statuses, durations, triggers and dates
 * are exact — driving real runs would make the expected numbers guesswork.
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import Run from '../models/Run.js';
import Workflow from '../models/Workflow.js';

const B = process.env.BASE || 'http://localhost:4700/api';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`); ok ? pass++ : fail++; };

async function req(method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(B + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, body: json };
}

await mongoose.connect(env.mongodbUri);

const auth = (await req('POST', '/auth/register', { email: `an${Date.now()}@e.com`, password: 'password123' })).body;
const token = auth.token;
const ownerId = new mongoose.Types.ObjectId(auth.user.id || auth.user._id);
const fresh = (await req('POST', '/auth/register', { email: `fr${Date.now()}@e.com`, password: 'password123' })).body;

const node = (id, type, config) => ({ id, type, position: { x: 0, y: 0 }, data: { config } });
const wf = await Workflow.create({
  ownerId, name: 'Analytics fixture',
  nodes: [
    node('s', 'start', { label: 'Start' }),
    node('a1', 'agent', { label: 'A1' }), node('a2', 'agent', { label: 'A2' }),
    node('t1', 'tool', { label: 'T1', toolType: 'calculator' }),
    node('t2', 'tool', { label: 'T2', toolType: 'calculator' }),
    node('t3', 'tool', { label: 'T3', toolType: 'send-email' }),
    node('c', 'condition', { label: 'C', expression: 'true' }),
    node('e', 'end', { label: 'End' }),
  ],
  edges: [{ id: 'e1', source: 's', target: 'a1' }],
});

const daysAgo = (n, hour = 12) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(hour, 0, 0, 0); return d; };
const mkRun = (status, trigger, durationMs, ago) => {
  const startedAt = daysAgo(ago);
  return {
    workflowId: wf._id, ownerId, status, trigger,
    startedAt, finishedAt: durationMs == null ? null : new Date(startedAt.getTime() + durationMs),
    createdAt: startedAt, updatedAt: startedAt, nodeResults: [],
  };
};

// 5 success (1s, 2s, 3s, 4s, 10s), 2 failed (5s, 5s), 1 cancelled (1s), 1 running (no finish)
// durations of finished runs: 1000,2000,3000,4000,10000,5000,5000,1000 -> avg 3875, median 3500
await Run.insertMany([
  mkRun('success', 'manual', 1000, 1), mkRun('success', 'manual', 2000, 1),
  mkRun('success', 'schedule', 3000, 2), mkRun('success', 'webhook', 4000, 3),
  mkRun('success', 'event', 10000, 3),
  mkRun('failed', 'manual', 5000, 4), mkRun('failed', 'schedule', 5000, 5),
  mkRun('cancelled', 'manual', 1000, 6),
  mkRun('running', 'manual', null, 0),
  // outside a 30-day window, inside 90
  mkRun('success', 'manual', 2000, 60),
], { timestamps: false });

console.log('30-day window');
let r = await req('GET', '/analytics/summary?days=30', undefined, token);
let a = r.body;
check('HTTP 200', r.status === 200);
check(`totalRuns = ${a.totalRuns} (expect 9 — the 60-day-old run excluded)`, a.totalRuns === 9);
check(`status breakdown ${JSON.stringify(a.statusBreakdown)}`,
      a.statusBreakdown.success === 5 && a.statusBreakdown.failed === 2 && a.statusBreakdown.cancelled === 1 && a.statusBreakdown.active === 1);
check(`successRate = ${a.successRate} (5/8 finished = 0.625 — the running one is excluded)`, Math.abs(a.successRate - 0.625) < 1e-9);
check(`avgDurationMs = ${a.avgDurationMs} (expect 3875)`, a.avgDurationMs === 3875);
check(`medianDurationMs = ${a.medianDurationMs} (expect 3500)`, a.medianDurationMs === 3500);

console.log('\nruns over time');
check(`runsByDay has ${a.runsByDay.length} entries (expect 30, zero-filled)`, a.runsByDay.length === 30);
check('every entry has date + numeric count', a.runsByDay.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && typeof d.count === 'number'));
check('dates ascend without gaps', a.runsByDay.every((d, i) => i === 0 || d.date > a.runsByDay[i - 1].date));
check(`counts sum to totalRuns (${a.runsByDay.reduce((s, d) => s + d.count, 0)})`, a.runsByDay.reduce((s, d) => s + d.count, 0) === 9);
check('quiet days present as zeros', a.runsByDay.some((d) => d.count === 0));

console.log('\ntriggers');
const trig = Object.fromEntries(a.runsByTrigger.map((t) => [t.trigger, t.count]));
check(`by trigger ${JSON.stringify(trig)}`, trig.manual === 5 && trig.schedule === 2 && trig.webhook === 1 && trig.event === 1);
check('sorted by count desc', a.runsByTrigger.every((t, i) => i === 0 || t.count <= a.runsByTrigger[i - 1].count));

console.log('\nnode + tool type usage (design-time, across workflows)');
const nt = Object.fromEntries(a.topNodeTypes.map((n) => [n.type, n.count]));
check(`node types ${JSON.stringify(nt)}`, nt.agent === 2 && nt.tool === 3 && nt.condition === 1 && nt.start === 1 && nt.end === 1);
const tt = Object.fromEntries(a.topToolTypes.map((n) => [n.type, n.count]));
check(`tool types ${JSON.stringify(tt)}`, tt.calculator === 2 && tt['send-email'] === 1);
check('unset toolTypes excluded', !Object.keys(tt).includes('') && !Object.keys(tt).includes('null'));

console.log('\n90-day window includes the older run');
r = await req('GET', '/analytics/summary?days=90', undefined, token);
check(`totalRuns = ${r.body.totalRuns} (expect 10)`, r.body.totalRuns === 10);
check(`runsByDay length = ${r.body.runsByDay.length} (expect 90)`, r.body.runsByDay.length === 90);

console.log('\n7-day window');
r = await req('GET', '/analytics/summary?days=7', undefined, token);
check(`totalRuns = ${r.body.totalRuns} (expect 9 — all within 7 days)`, r.body.totalRuns === 9);
check(`runsByDay length = ${r.body.runsByDay.length} (expect 7)`, r.body.runsByDay.length === 7);

console.log('\nrange validation + scoping');
r = await req('GET', '/analytics/summary?days=999', undefined, token);
check('unsupported range falls back to 30', r.body.rangeDays === 30, String(r.body.rangeDays));
r = await req('GET', '/analytics/summary?days=abc', undefined, token);
check('non-numeric range falls back to 30', r.body.rangeDays === 30);
r = await req('GET', '/analytics/summary');
check('unauthenticated 401', r.status === 401, String(r.status));

console.log('\nempty state for a brand-new user');
r = await req('GET', '/analytics/summary?days=30', undefined, fresh.token);
a = r.body;
check('HTTP 200, not an error', r.status === 200);
check(`totalRuns = 0`, a.totalRuns === 0);
check('successRate is null, not NaN or 0', a.successRate === null, JSON.stringify(a.successRate));
check('durations null, not NaN', a.avgDurationMs === null && a.medianDurationMs === null, `${a.avgDurationMs}/${a.medianDurationMs}`);
check('runsByDay still 30 zero-filled entries', a.runsByDay.length === 30 && a.runsByDay.every((d) => d.count === 0));
check('no other user\'s data leaks in', a.topNodeTypes.length === 0 && a.topToolTypes.length === 0, JSON.stringify(a.topNodeTypes));

await Run.deleteMany({ ownerId });
await Workflow.deleteMany({ ownerId });
await mongoose.disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
