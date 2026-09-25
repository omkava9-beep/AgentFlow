/**
 * Advanced-node check for spec/31 - the acceptance criteria as a runnable script.
 *
 *   npm run check:nodes
 *
 * Like check:engine it drives executeRun directly against a throwaway database
 * (your MONGODB_URI with a `-nodescheck` suffix) and drops it on the way out.
 * Body / child workflows are real Workflow documents, because loop and
 * sub-workflow nodes load them from the run's workspace.
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { executeRun, requestCancel, cancelWaitingRun } from '../engine/executeRun.js';
import { validateNodeStructure, checkCodeAuthorship } from '../engine/validateNodes.js';
import { resolveValue } from '../integrations/template.js';
import Run from '../models/Run.js';
import Workflow from '../models/Workflow.js';
import Workspace from '../models/Workspace.js';
import WorkflowVersion from '../models/WorkflowVersion.js';
import { contentHash } from '../services/versionService.js';
import { queue } from '../queue/index.js';
import { toolCache } from '../cache/TTLCache.js';

const CHECK_DB_URI = `${env.mongodbUri.replace(/\/+$/, '')}-nodescheck`;
const WS = new mongoose.Types.ObjectId(); // no Workspace doc: uncapped, like check:engine
const OTHER_WS = new mongoose.Types.ObjectId();

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const node = (id, type, config = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { config: { label: id, ...config } } });
const edge = (source, target, extra = {}) => ({ id: `e-${source}-${target}-${extra.sourceHandle || ''}`, source, target, ...extra });
const weather = (id, over = {}, params = {}) => node(id, 'tool', {
  integration: 'builtin', action: 'fake-weather', connectionId: null, params: { city: id, ...params },
  mockOverrides: { failureRate: 0, latencyMs: [60, 90], ...over },
});
const code = (id, source, over = {}) => node(id, 'code', { source, ...over });

async function saveWorkflow(name, nodes, edges, workspaceId = WS) {
  const workflow = await Workflow.create({ workspaceId, name, nodes, edges });
  await publishDoc(workflow._id);
  return workflow;
}

/**
 * spec/30: loop bodies and sub-workflows run their child's PUBLISHED version,
 * so every body/child fixture is published - and re-published after a direct
 * edit, the way someone would press Publish after changing it.
 */
async function publishDoc(workflowId) {
  const wf = await Workflow.findById(workflowId).lean();
  const version = (wf.versionCounter || 0) + 1;
  const v = await WorkflowVersion.create({
    workflowId: wf._id, workspaceId: wf.workspaceId, version, name: wf.name,
    nodes: wf.nodes, edges: wf.edges, contentHash: contentHash(wf),
  });
  await Workflow.updateOne({ _id: wf._id }, { $set: {
    versionCounter: version, publishedVersionId: v._id, publishedVersion: version, publishedContentHash: v.contentHash,
  } });
}

async function run(workflow, { input = null, timeoutMs, workspaceId = WS } = {}) {
  toolCache.clear();
  const wf = { _id: workflow._id || new mongoose.Types.ObjectId(), workspaceId, ...workflow };
  const doc = await Run.create({ workflowId: wf._id, workspaceId, status: 'pending', input });
  const id = doc._id.toString();
  const finished = await executeRun(id, wf, { input, ...(timeoutMs && { timeoutMs }) });
  const byId = Object.fromEntries(finished.nodeResults.map((r) => [r.nodeId, r]));
  return { runDoc: finished, byId, id };
}

/** Start a run without waiting, for cancellation tests. */
async function startRun(workflow, { input = null } = {}) {
  const wf = { _id: new mongoose.Types.ObjectId(), workspaceId: WS, ...workflow };
  const doc = await Run.create({ workflowId: wf._id, workspaceId: WS, status: 'pending', input });
  const id = doc._id.toString();
  return { id, done: executeRun(id, wf, { input }) };
}

const linear = (...ns) => ns.slice(1).map((n, i) => edge(ns[i].id, n.id));

await mongoose.connect(CHECK_DB_URI);
console.log(`nodes check · concurrency=${queue.concurrency} · codeTimeout=${env.codeNodeTimeoutMs}ms\n`);

// ---------------------------------------------------------------- A: transform
console.log('A. transform + typed template resolution');
{
  check('resolveValue: single placeholder keeps the array', Array.isArray(resolveValue('{{input.items}}', { input: { items: [1, 2] } })));
  check('resolveValue: mixed text becomes a string', resolveValue('Order {{input.id}}', { input: { id: 7 } }) === 'Order 7');
  const s = node('s', 'start');
  const t = node('t', 'transform', { mode: 'replace', mappings: [
    { key: 'items', value: '{{input.orders}}' },
    { key: 'customer.name', value: '{{input.who}}' },
    { key: 'title', value: 'Order for {{input.who}}' },
    { key: 'missing', value: '{{input.nope}}' },
  ] });
  const e = node('e', 'end');
  const { byId, runDoc } = await run({ nodes: [s, t, e], edges: linear(s, t, e) }, { input: { orders: [{ id: 1 }, { id: 2 }], who: 'Ada', extra: true } });
  const out = byId.t.output;
  check('run succeeds', runDoc.status === 'success', runDoc.status);
  check('array passes through intact', Array.isArray(out.items) && out.items.length === 2 && out.items[1].id === 2, JSON.stringify(out.items));
  check('dotted key builds nested output', out.customer?.name === 'Ada');
  check('mixed text resolves to a string', out.title === 'Order for Ada');
  check('replace mode drops unmapped input keys', !('extra' in out));
  check('unresolved reference → empty value + log, node still succeeds', out.missing === '' && byId.t.logs.some((l) => /unresolved/.test(l)));
  const m = node('m', 'transform', { mode: 'merge', mappings: [{ key: 'added', value: '{{input.who}}!' }] });
  const r2 = await run({ nodes: [s, m, e], edges: linear(s, m, e) }, { input: { who: 'Bo', keep: 1 } });
  check('merge mode shallow-merges over the input', r2.byId.m.output.keep === 1 && r2.byId.m.output.added === 'Bo!');
  check('end persists the transform output as the run result', r2.byId.e.output?.added === 'Bo!');
}

// ---------------------------------------------------------------- B: code
console.log('\nB. code node');
{
  const s = node('s', 'start'); const e = node('e', 'end');
  const add = code('c', 'console.log("adding"); return input.a + input.b;');
  const r = await run({ nodes: [s, add, e], edges: linear(s, add, e) }, { input: { a: 2, b: 3 } });
  check('returns input.a + input.b', r.byId.c.output === 5, JSON.stringify(r.byId.c.output));
  check('console.log is captured into the node logs', r.byId.c.logs.some((l) => l.includes('adding')));

  const spin = code('c', 'while (true) {}');
  const t0 = Date.now();
  const r2 = await run({ nodes: [s, spin, e], edges: linear(s, spin, e) });
  check('while(true) fails at the timeout', r2.byId.c.status === 'failed' && r2.byId.c.logs.some((l) => /timed out/.test(l)), `${Date.now() - t0}ms`);
  check('a timeout is permanent: 1 attempt, no retries', r2.byId.c.attempts === 1);

  const hog = code('c', 'const a = []; while (true) a.push(new Array(1e6).fill(Math.random())); return 1;');
  const r3 = await run({ nodes: [s, hog, e], edges: linear(s, hog, e) });
  check('allocating without bound fails at the memory cap (or the timeout)', r3.byId.c.status === 'failed' && r3.byId.c.logs.some((l) => /memory limit|timed out/.test(l)), r3.byId.c.logs.at(-1));

  // node:vm is NOT a sandbox (spec/31 §2): an object from the worker's own realm
  // reaches `process`. What the empty `env` guarantees is that there's nothing
  // secret to read there.
  const escape = code('c', 'const p = input.constructor.constructor("return process")(); return Object.keys(p.env).length;');
  const r4 = await run({ nodes: [s, escape, e], edges: linear(s, escape, e) }, { input: { any: 1 } });
  check("the worker's process.env is empty (even via a vm escape)", r4.byId.c.output === 0, JSON.stringify(r4.byId.c.output));

  const undef = code('c', 'const x = 1;');
  const r5 = await run({ nodes: [s, undef, e], edges: linear(s, undef, e) });
  check('returning undefined → null output + log', r5.byId.c.output === null && r5.byId.c.logs.some((l) => /returned undefined/.test(l)));

  const throws = code('c', 'throw new Error("nope")');
  const r6 = await run({ nodes: [s, throws, e], edges: linear(s, throws, e) });
  check('a thrown error fails the node permanently', r6.byId.c.status === 'failed' && r6.byId.c.attempts === 1 && r6.byId.c.logs.some((l) => /nope/.test(l)));
  check('...and fails the run (no error edge)', r6.runDoc.status === 'failed');

  // No timers in the context (spec/31 §2 lists input, console, JSON, Math, Date),
  // but a returned promise is still awaited within the deadline.
  const awaited = code('c', 'const v = await Promise.resolve("later"); return v;');
  const r7 = await run({ nodes: [s, awaited, e], edges: linear(s, awaited, e) });
  check('a returned promise is awaited', r7.byId.c.output === 'later');

  const big = code('c', 'return "x".repeat(300 * 1024);');
  const r8 = await run({ nodes: [s, big, e], edges: linear(s, big, e) });
  check('output over 256 KB fails', r8.byId.c.status === 'failed' && r8.byId.c.logs.some((l) => /limit/.test(l)));
}

// ---------------------------------------------------------------- C: delay
console.log('\nC. delay');
{
  const s = node('s', 'start'); const e = node('e', 'end');
  const d = node('d', 'delay', { mode: 'duration', durationMs: 600 });
  let peak = 0;
  const onStats = (st) => { peak = Math.max(peak, st.active); };
  queue.on('stats', onStats);
  const t0 = Date.now();
  const r = await run({ nodes: [s, d, e], edges: linear(s, d, e) }, { input: { keep: 'me' } });
  queue.off('stats', onStats);
  check('a 600ms delay completes and passes its input through', r.byId.d.status === 'success' && r.byId.e.output?.keep === 'me', `${Date.now() - t0}ms`);
  check('the delay held no queue slot (peak active 0)', peak === 0, `peak ${peak}`);

  const long = node('d', 'delay', { mode: 'duration', durationMs: 5000 });
  const started = await startRun({ nodes: [s, long, e], edges: linear(s, long, e) });
  await sleep(300);
  const tCancel = Date.now();
  requestCancel(started.id);
  const done = await started.done;
  check('cancelling mid-delay ends the run within 200ms', Date.now() - tCancel < 200 && done.status === 'cancelled', `${Date.now() - tCancel}ms ${done.status}`);
  check('...and the delay node is skipped, not failed', done.nodeResults.find((x) => x.nodeId === 'd').status === 'skipped');

  // spec/32: over the inline limit, a delay parks the run instead of sleeping.
  const tooLong = node('d', 'delay', { mode: 'duration', durationMs: env.delayInlineMaxMs + 1000 });
  const r3 = await run({ nodes: [s, tooLong, e], edges: linear(s, tooLong, e) });
  check('a delay over the inline limit parks the run (spec 32)', r3.runDoc.status === 'waiting' && r3.byId.d.status === 'waiting' && Boolean(r3.byId.d.resumeAt), `${r3.runDoc.status}/${r3.byId.d.status}`);
  await cancelWaitingRun(r3.id);
}

// ---------------------------------------------------------------- D: loop
console.log('\nD. loop / for-each');
{
  const bodyStart = node('bs', 'start');
  const bodyWork = weather('bw', { latencyMs: [120, 160] });
  const bodyTimes = code('bt', 'return { doubled: input.item * 2, index: input.index, total: input.total };');
  const bodyEnd = node('be', 'end');
  const body = await saveWorkflow('loop body', [bodyStart, bodyWork, bodyTimes, bodyEnd],
    [edge('bs', 'bw'), edge('bs', 'bt'), edge('bt', 'be'), edge('bw', 'be')]);
  // The End node joins both branches; read the code branch's value from it.
  const bodyCodeOnly = await saveWorkflow('loop body (code)', [bodyStart, bodyTimes, bodyEnd], linear(bodyStart, bodyTimes, bodyEnd));

  const s = node('s', 'start'); const e = node('e', 'end');
  const loop = node('l', 'loop', { itemsPath: '{{input.items}}', workflowId: String(body._id), concurrency: 3 });
  const items = Array.from({ length: 20 }, (_, i) => i);
  const started = await startRun({ nodes: [s, loop, e], edges: linear(s, loop, e) }, { input: { items } });
  let peakChildren = 0;
  let sameBodyAtOnce = 0;
  const sampler = setInterval(async () => {
    const live = await Run.countDocuments({ parentRunId: started.id, status: { $in: ['pending', 'running'] } });
    peakChildren = Math.max(peakChildren, live);
    sameBodyAtOnce = Math.max(sameBodyAtOnce, live);
  }, 15);
  const done = await started.done;
  clearInterval(sampler);
  const l = done.nodeResults.find((x) => x.nodeId === 'l');
  check('loop over 20 items succeeds', l.status === 'success' && done.status === 'success', `${l.status} ${(l.logs || []).at(-1)}`);
  check('never more than 3 child runs in flight', peakChildren <= 3 && peakChildren >= 2, `peak ${peakChildren}`);
  check('the 409 guard is skipped: several children of one body run at once', sameBodyAtOnce > 1);
  const res = l.output?.results || [];
  check('results are in index order', res.length === 20 && res.every((r, i) => r.index === i));
  check('succeeded/failed/total reported', l.output.succeeded === 20 && l.output.failed === 0 && l.output.total === 20);
  check('progress ends at 20 / 20', l.progress?.done === 20 && l.progress?.total === 20, JSON.stringify(l.progress));
  const children = await Run.find({ parentRunId: started.id }).sort({ iteration: 1 });
  check('each iteration is an inspectable child run', children.length === 20 && children.every((c, i) => c.iteration === i && c.trigger === 'subworkflow' && c.depth === 1 && String(c.rootRunId) === started.id));
  check('node result lists every child run id', (l.childRunIds || []).length === 20);

  const r2 = await run({ nodes: [s, node('l', 'loop', { itemsPath: '{{input.items}}', workflowId: String(bodyCodeOnly._id), concurrency: 4 }), e], edges: [edge('s', 'l'), edge('l', 'e')] }, { input: { items: [5, 6, 7] } });
  check("child input is { item, index, total, parent } and output is the body's End output",
    r2.byId.l.output.results.map((x) => x.output?.doubled).join(',') === '10,12,14' && r2.byId.l.output.results[2].output.total === 3,
    JSON.stringify(r2.byId.l.output.results.map((x) => x.output)));

  const r3 = await run({ nodes: [s, node('l', 'loop', { itemsPath: '{{input.items}}', workflowId: String(body._id) }), e], edges: [edge('s', 'l'), edge('l', 'e')] }, { input: { items: [] } });
  check('empty array → success with total 0, downstream still runs', r3.byId.l.status === 'success' && r3.byId.l.output.total === 0 && r3.byId.e.status === 'success');

  const r4 = await run({ nodes: [s, node('l', 'loop', { itemsPath: '{{input.items}}', workflowId: String(body._id) }), e], edges: [edge('s', 'l'), edge('l', 'e')] }, { input: { items: 'nope' } });
  check('items that are not an array → permanent failure', r4.byId.l.status === 'failed' && r4.byId.l.logs.some((x) => /array/.test(x)));

  const r5 = await run({ nodes: [s, node('l', 'loop', { itemsPath: '{{input.items}}', workflowId: String(body._id), maxItems: 3 }), e], edges: [edge('s', 'l'), edge('l', 'e')] }, { input: { items: [1, 2, 3, 4] } });
  check('more than maxItems → fails with a raise-the-limit hint', r5.byId.l.status === 'failed' && r5.byId.l.logs.some((x) => /limit is 3/.test(x)));

  const flaky = await saveWorkflow('odd fails', [bodyStart, code('bt', 'if (input.item % 2) throw new Error("odd " + input.item); return input.item;'), bodyEnd], [edge('bs', 'bt'), edge('bt', 'be')]);
  const stop = await run({ nodes: [s, node('l', 'loop', { itemsPath: '{{input.items}}', workflowId: String(flaky._id), concurrency: 1 }), e], edges: [edge('s', 'l'), edge('l', 'e')] }, { input: { items: [0, 1, 2, 3, 4] } });
  const stopChildren = await Run.countDocuments({ parentRunId: stop.id });
  check('continueOnError=false: first failure stops new dispatches and fails the node', stop.byId.l.status === 'failed' && stopChildren === 2, `children ${stopChildren}`);
  const cont = await run({ nodes: [s, node('l', 'loop', { itemsPath: '{{input.items}}', workflowId: String(flaky._id), concurrency: 2, continueOnError: true }), e], edges: [edge('s', 'l'), edge('l', 'e')] }, { input: { items: [0, 1, 2, 3, 4] } });
  check('continueOnError=true: every item runs, node succeeds with counts', cont.byId.l.status === 'success' && cont.byId.l.output.succeeded === 3 && cont.byId.l.output.failed === 2);

  const foreign = await saveWorkflow('other tenant body', [bodyStart, bodyEnd], [edge('bs', 'be')], OTHER_WS);
  const r6 = await run({ nodes: [s, node('l', 'loop', { itemsPath: '{{input.items}}', workflowId: String(foreign._id) }), e], edges: [edge('s', 'l'), edge('l', 'e')] }, { input: { items: [1] } });
  check("another workspace's body workflow is not found", r6.byId.l.status === 'failed' && r6.byId.l.logs.some((x) => /not found/.test(x)));
}

// ---------------------------------------------------------------- E: no deadlock
console.log('\nE. no deadlock with a tiny pool (QUEUE_CONCURRENCY=2)');
{
  const saved = queue.concurrency;
  queue.concurrency = 2;
  const leaf = await saveWorkflow('leaf', [node('ls', 'start'), weather('lw', { latencyMs: [40, 60] }), node('le', 'end')], [edge('ls', 'lw'), edge('lw', 'le')]);
  const mid = await saveWorkflow('mid (calls leaf)', [node('ms', 'start'), node('msub', 'subworkflow', { workflowId: String(leaf._id) }), weather('mw', { latencyMs: [30, 50] }), node('me', 'end')],
    [edge('ms', 'msub'), edge('ms', 'mw'), edge('msub', 'me'), edge('mw', 'me')]);
  const inner = await saveWorkflow('inner loop', [node('is', 'start'), node('il', 'loop', { itemsPath: '[1,2,3]', workflowId: String(mid._id), concurrency: 3 }), node('ie', 'end')],
    [edge('is', 'il'), edge('il', 'ie')]);
  // itemsPath '[1,2,3]' isn't a template; give the inner loop real items instead.
  await Workflow.updateOne({ _id: inner._id }, { $set: { 'nodes.1.data.config.itemsPath': '{{input.parent.inner}}' } });
  await publishDoc(inner._id);
  const s = node('s', 'start'); const e = node('e', 'end');
  const outer = node('l', 'loop', { itemsPath: '{{input.items}}', workflowId: String(inner._id), concurrency: 3 });
  const t0 = Date.now();
  const r = await run({ nodes: [s, outer, e], edges: linear(s, outer, e) }, { input: { items: [1, 2, 3], inner: [1, 2, 3] }, timeoutMs: 60_000 });
  check('a loop of loops of sub-workflows completes (no deadlock)', r.runDoc.status === 'success' && r.byId.l.output.succeeded === 3, `${r.runDoc.status} in ${Date.now() - t0}ms`);
  const descendants = await Run.countDocuments({ rootRunId: r.id });
  check('all 3 × 3 × 2 descendant runs executed', descendants === 3 + 9 + 9, `${descendants}`);
  queue.concurrency = saved;
}

// ---------------------------------------------------------------- F: merge
console.log('\nF. merge');
{
  const s = node('s', 'start'); const e = node('e', 'end');
  const cond = node('c', 'condition', { expression: 'true' });
  const a = weather('a'); const b = weather('b');
  const mAll = node('m', 'merge', { mode: 'all', output: 'keyed' });
  const r = await run({ nodes: [s, cond, a, b, mAll, e], edges: [edge('s', 'c'), edge('c', 'a', { sourceHandle: 'true' }), edge('c', 'b', { sourceHandle: 'false' }), edge('a', 'm'), edge('b', 'm'), edge('m', 'e')] });
  check("merge 'all' fails when one branch was skipped", r.byId.b.status === 'skipped' && r.byId.m.status === 'failed' && r.byId.m.logs.some((l) => /did not complete/.test(l)), (r.byId.m.logs || []).at(-1));
  const mAny = node('m', 'merge', { mode: 'any', output: 'keyed' });
  const r2 = await run({ nodes: [s, cond, a, b, mAny, e], edges: [edge('s', 'c'), edge('c', 'a', { sourceHandle: 'true' }), edge('c', 'b', { sourceHandle: 'false' }), edge('a', 'm'), edge('b', 'm'), edge('m', 'e')] });
  check("merge 'any' runs with the live inputs", r2.byId.m.status === 'success' && Object.keys(r2.byId.m.output).join() === 'a');

  const fast = weather('fast', { latencyMs: [60, 70] });
  const slow = weather('slow', { latencyMs: [700, 750] });
  const mFirst = node('m', 'merge', { mode: 'first', output: 'array' });
  const r3 = await run({ nodes: [s, fast, slow, mFirst, e], edges: [edge('s', 'fast'), edge('s', 'slow'), edge('fast', 'm'), edge('slow', 'm'), edge('m', 'e')] });
  const mStart = new Date(r3.byId.m.startedAt).getTime();
  const slowEnd = new Date(r3.byId.slow.finishedAt).getTime();
  check("merge 'first' runs as soon as the fastest branch succeeds", mStart < slowEnd, `merge started ${slowEnd - mStart}ms before slow finished`);
  check('...uses only the fastest output', r3.byId.m.output.length === 1 && r3.byId.m.output[0].city === 'fast');
  check('...and the run still finishes only after every branch settles', r3.byId.slow.status === 'success' && new Date(r3.runDoc.finishedAt).getTime() >= slowEnd);

  const mArr = node('m', 'merge', { mode: 'any', output: 'merged' });
  const r4 = await run({ nodes: [s, a, b, mArr, e], edges: [edge('s', 'a'), edge('s', 'b'), edge('a', 'm'), edge('b', 'm'), edge('m', 'e')] });
  check("output 'merged' shallow-merges object outputs", typeof r4.byId.m.output.tempC === 'number' && ['a', 'b'].includes(r4.byId.m.output.city));
}

// ---------------------------------------------------------------- G: sub-workflow
console.log('\nG. sub-workflow');
{
  const child = await saveWorkflow('child', [node('cs', 'start'), node('ct', 'transform', { mappings: [{ key: 'greeting', value: 'Hi {{input.name}}' }] }), node('ce', 'end')],
    [edge('cs', 'ct'), edge('ct', 'ce')]);
  const s = node('s', 'start'); const e = node('e', 'end');
  const sub = node('sw', 'subworkflow', { workflowId: String(child._id), inputMapping: [{ key: 'name', value: '{{input.who}}' }] });
  const r = await run({ nodes: [s, sub, e], edges: linear(s, sub, e) }, { input: { who: 'Cy' } });
  check("output is the child's End output (input mapping applied)", r.byId.sw.output?.greeting === 'Hi Cy', JSON.stringify(r.byId.sw.output));
  const kids = await Run.find({ parentRunId: r.id });
  check('child run is linked (parentRunId, parentNodeId, rootRunId, depth 1, trigger subworkflow)',
    kids.length === 1 && kids[0].parentNodeId === 'sw' && String(kids[0].rootRunId) === r.id && kids[0].depth === 1 && kids[0].trigger === 'subworkflow');
  check('node result carries childRunIds', String(r.byId.sw.childRunIds?.[0]) === String(kids[0]?._id));

  const noMap = node('sw', 'subworkflow', { workflowId: String(child._id) });
  const r2 = await run({ nodes: [s, noMap, e], edges: linear(s, noMap, e) }, { input: { name: 'Di' } });
  check('without a mapping the parent input passes through', r2.byId.sw.output?.greeting === 'Hi Di');

  const broken = await saveWorkflow('broken child', [node('bs', 'start'), code('boom', 'throw new Error("kaput")'), node('be', 'end')], [edge('bs', 'boom'), edge('boom', 'be')]);
  const r3 = await run({ nodes: [s, node('sw', 'subworkflow', { workflowId: String(broken._id) }), e], edges: linear(s, node('sw', 'subworkflow'), e) });
  check('a failed child fails the node, naming the failing child node', r3.byId.sw.status === 'failed' && r3.byId.sw.logs.some((l) => /boom/.test(l)), (r3.byId.sw.logs || []).at(-1));

  const foreign = await saveWorkflow('foreign child', [node('fs', 'start'), node('fe', 'end')], [edge('fs', 'fe')], OTHER_WS);
  const r4 = await run({ nodes: [s, node('sw', 'subworkflow', { workflowId: String(foreign._id) }), e], edges: linear(s, node('sw', 'subworkflow'), e) });
  check("another workspace's workflow → 'Sub-workflow not found'", r4.byId.sw.status === 'failed' && r4.byId.sw.logs.some((l) => /Sub-workflow not found/.test(l)));

  // A workflow that calls itself: recursion stops at the depth limit.
  const selfRef = await saveWorkflow('recursive', [], []);
  await Workflow.updateOne({ _id: selfRef._id }, { $set: {
    nodes: [node('rs', 'start'), node('rsub', 'subworkflow', { workflowId: String(selfRef._id) }), node('re', 'end')],
    edges: [edge('rs', 'rsub'), edge('rsub', 're')],
  } });
  await publishDoc(selfRef._id);
  const r5 = await run({ nodes: [s, node('sw', 'subworkflow', { workflowId: String(selfRef._id) }), e], edges: linear(s, node('sw', 'subworkflow'), e) }, { timeoutMs: 60_000 });
  const chain = await Run.find({ rootRunId: r5.id }).sort({ depth: 1 });
  const deepest = chain.at(-1);
  check(`self-reference stops at depth ${env.subworkflowMaxDepth}`, deepest?.depth === env.subworkflowMaxDepth && r5.runDoc.status === 'failed', `deepest ${deepest?.depth}`);
  check('the deepest run fails with the depth-limit message', (deepest?.nodeResults || []).some((nr) => (nr.logs || []).some((l) => /depth limit \(5\) reached/.test(l))));
}

// ---------------------------------------------------------------- H: cancel cascade
console.log('\nH. cancellation cascades to every descendant');
{
  const waitBody = await saveWorkflow('slow body', [node('ws', 'start'), node('wd', 'delay', { durationMs: 3000 }), node('we', 'end')], [edge('ws', 'wd'), edge('wd', 'we')]);
  const s = node('s', 'start'); const e = node('e', 'end');
  const started = await startRun({ nodes: [s, node('l', 'loop', { itemsPath: '{{input.items}}', workflowId: String(waitBody._id), concurrency: 3 }), e], edges: [edge('s', 'l'), edge('l', 'e')] }, { input: { items: [1, 2, 3, 4, 5, 6] } });
  await sleep(400);
  const t0 = Date.now();
  requestCancel(started.id);
  const done = await started.done;
  await sleep(100);
  const descendants = await Run.find({ rootRunId: started.id });
  check('parent ends cancelled promptly', done.status === 'cancelled' && Date.now() - t0 < 1000, `${done.status} in ${Date.now() - t0}ms`);
  check('every descendant run ends cancelled', descendants.length >= 3 && descendants.every((d) => d.status === 'cancelled'), descendants.map((d) => d.status).join(','));
  check("the parent's loop node is skipped, not failed", done.nodeResults.find((x) => x.nodeId === 'l').status === 'skipped');
  check('no new iterations were dispatched after the cancel', descendants.length === 3, `${descendants.length}`);
}

// ---------------------------------------------------------------- I: error branch
console.log('\nI. on-error branch');
{
  const s = node('s', 'start'); const e = node('e', 'end');
  const bad = weather('bad', { failureRate: 1, maxAttempts: 3 });
  const fallback = node('fb', 'transform', { mappings: [{ key: 'recovered', value: '{{input.error.message}}' }, { key: 'tries', value: '{{input.error.attempts}}' }] });
  const happy = node('ok', 'transform', { mappings: [{ key: 'normal', value: 'yes' }] });
  const edges = [edge('s', 'bad'), edge('bad', 'ok'), edge('bad', 'fb', { sourceHandle: 'error' }), edge('ok', 'e'), edge('fb', 'e')];
  const r = await run({ nodes: [s, bad, happy, fallback, e], edges });
  check('retries 3 times before taking the error branch', r.byId.bad.attempts === 3, `attempts ${r.byId.bad.attempts}`);
  check("node shows failed + handled", r.byId.bad.status === 'failed' && r.byId.bad.handled === true);
  check('error branch receives { error, input }', /simulated failure/.test(r.byId.fb.output?.recovered || '') && r.byId.fb.output?.tries === 3, JSON.stringify(r.byId.fb.output));
  check('the normal path is skipped', r.byId.ok.status === 'skipped');
  check('the run ends success', r.runDoc.status === 'success', r.runDoc.status);

  const r2 = await run({ nodes: [s, bad, happy, e], edges: [edge('s', 'bad'), edge('bad', 'ok'), edge('ok', 'e')] });
  check('the same tool without an error edge fails the run (phase-2 behaviour)', r2.runDoc.status === 'failed' && !r2.byId.bad.handled);

  const good = weather('bad');
  const r3 = await run({ nodes: [s, good, happy, fallback, e], edges });
  check('on success the error path is skipped', r3.byId.fb.status === 'skipped' && r3.byId.ok.status === 'success' && r3.runDoc.status === 'success');

  const brokenFallback = code('fb', 'throw new Error("fallback broke")');
  const r4 = await run({ nodes: [s, bad, happy, brokenFallback, e], edges });
  check('an unhandled failure downstream of a handled one fails the run', r4.runDoc.status === 'failed');

  const loopErr = await saveWorkflow('always fails', [node('as', 'start'), code('ax', 'throw new Error("x")'), node('ae', 'end')], [edge('as', 'ax'), edge('ax', 'ae')]);
  const r5 = await run({ nodes: [s, node('l', 'loop', { itemsPath: '{{input.items}}', workflowId: String(loopErr._id) }), fallback, e], edges: [edge('s', 'l'), edge('l', 'fb', { sourceHandle: 'error' }), edge('fb', 'e')] }, { input: { items: [1] } });
  check('a failed loop can take its error branch too', r5.byId.l.handled === true && r5.runDoc.status === 'success');
}

// ---------------------------------------------------------------- J: validation
console.log('\nJ. server-side node validation');
{
  const nodes = [node('s', 'start'), node('c', 'condition', { expression: 'true' }), weather('t'), node('e', 'end')];
  const errs = validateNodeStructure(nodes, [edge('c', 'e', { sourceHandle: 'error' }), edge('t', 'e', { sourceHandle: 'error' })]);
  check('an error edge from a condition is rejected; from a tool it is fine', errs.length === 1 && /condition/.test(errs[0]), errs.join(' | '));
  check('unknown node types are reported', validateNodeStructure([node('x', 'teleport')], []).length === 1);
  const before = [code('c1', 'return 1')];
  check('editor adding a Code node is refused', /code:author/.test(checkCodeAuthorship([], before, 'editor') || ''));
  check("editor changing a Code node's source is refused", /code:author/.test(checkCodeAuthorship(before, [code('c1', 'return 2')], 'editor') || ''));
  check('editor renaming/moving a Code node is fine', checkCodeAuthorship(before, [{ ...code('c1', 'return 1'), position: { x: 9, y: 9 }, data: { config: { label: 'renamed', source: 'return 1' } } }], 'editor') === null);
  check('admin may author code', checkCodeAuthorship([], before, 'admin') === null);
}

// ---------------------------------------------------------------- K: workspace cap
console.log('\nK. loop children count toward the workspace cap (spec/33)');
{
  const ws = await Workspace.create({ name: 'Capped', slug: `capped-${Date.now()}`, plan: 'free' });
  const body = await saveWorkflow('capped body', [node('bs', 'start'), weather('bw', { latencyMs: [250, 300] }), node('be', 'end')], [edge('bs', 'bw'), edge('bw', 'be')], ws._id);
  const s = node('s', 'start'); const e = node('e', 'end');
  let peakActive = 0; let peakQueued = 0;
  const sampler = setInterval(() => {
    const st = queue.statsFor(String(ws._id));
    peakActive = Math.max(peakActive, st.active); peakQueued = Math.max(peakQueued, st.queued);
  }, 10);
  const r = await run({ nodes: [s, node('l', 'loop', { itemsPath: '{{input.items}}', workflowId: String(body._id), concurrency: 6 }), e], edges: [edge('s', 'l'), edge('l', 'e')] }, { input: { items: [1, 2, 3, 4, 5, 6] }, workspaceId: ws._id });
  clearInterval(sampler);
  check('loop succeeds under a Free-plan cap', r.byId.l.status === 'success', r.byId.l.status);
  check('children never exceed the cap of 2 active jobs', peakActive <= 2 && peakActive >= 1, `peak active ${peakActive}`);
  check('the rest wait in the workspace queue', peakQueued >= 1, `peak queued ${peakQueued}`);
}

await mongoose.connection.dropDatabase();
await mongoose.disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
