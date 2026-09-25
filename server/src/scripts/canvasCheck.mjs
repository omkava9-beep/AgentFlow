/**
 * Canvas check - the server half of the builder's "Disable node" (n8n-style):
 *
 *   npm run check:canvas
 *
 * A disabled node doesn't execute: its input becomes its output, it's recorded
 * as skipped with skipReason 'disabled', and everything downstream still runs.
 * Multi-output nodes follow their positive branch. The validator reports a
 * disabled node's own problems as info so they never block a run, and the
 * collab op layer accepts the `disabled` flag as an ordinary config update.
 *
 * Uses a throwaway database (your MONGODB_URI + `-canvascheck`), dropped after.
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { executeRun } from '../engine/executeRun.js';
import { validateGraph } from '../engine/validateGraph.js';
import { applyOp, docFromWorkflow, docToPlain } from '../collab/ops.js';
import Run from '../models/Run.js';
import { toolCache } from '../cache/TTLCache.js';

const CHECK_DB_URI = `${env.mongodbUri.replace(/\/+$/, '')}-canvascheck`;
const WORKSPACE = new mongoose.Types.ObjectId();
const WF = new mongoose.Types.ObjectId();

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

const node = (id, type, config = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { config: { label: id, ...config } } });
const edge = (source, target, extra = {}) => ({ id: `e-${source}-${target}-${extra.sourceHandle || extra.label || ''}`, source, target, ...extra });
const weather = (id, over = {}) => node(id, 'tool', {
  integration: 'builtin', action: 'fake-weather', params: {}, mockOverrides: { failureRate: 0, latencyMs: [20, 40], maxAttempts: 1 }, ...over,
});

async function run(workflow, input = null) {
  toolCache.clear();
  const doc = await Run.create({ workflowId: WF, workspaceId: WORKSPACE, status: 'pending', input });
  const finished = await executeRun(doc._id.toString(), { _id: WF, workspaceId: WORKSPACE, ...workflow }, { input, timeoutMs: 20_000 });
  const byId = Object.fromEntries(finished.nodeResults.map((r) => [r.nodeId, r]));
  return { runDoc: finished, byId };
}

await mongoose.connect(CHECK_DB_URI);
console.log('canvas check · disabled nodes\n');

try {
  // ------------------------------------------------------------ A: pass-through
  console.log('A. a disabled node passes its input straight through');
  {
    const input = { vendor: 'Acme', amount: 42 };
    const wf = {
      nodes: [
        node('s', 'start'),
        node('t', 'transform', { mode: 'replace', mappings: [{ key: 'only', value: 'this' }], disabled: true }),
        node('e', 'end'),
      ],
      edges: [edge('s', 't'), edge('t', 'e')],
    };
    const { runDoc, byId } = await run(wf, input);
    check('run succeeds', runDoc.status === 'success', runDoc.status);
    check('disabled node is recorded as skipped / disabled', byId.t.status === 'skipped' && byId.t.skipReason === 'disabled', `${byId.t.status} ${byId.t.skipReason}`);
    check('its output is its input, unchanged', JSON.stringify(byId.t.output) === JSON.stringify(input), JSON.stringify(byId.t.output));
    check('downstream still runs and receives the input', byId.e.status === 'success' && JSON.stringify(byId.e.output) === JSON.stringify(input), JSON.stringify(byId.e.output));
    check('the node logs why it did nothing', (byId.t.logs || []).some((l) => /disabled/.test(l)));
  }

  // ------------------------------------------------------------ B: a failing tool
  console.log('\nB. disabling a failing tool unblocks the run');
  {
    const wf = {
      nodes: [node('s', 'start'), weather('bad', { mockOverrides: { failureRate: 1, maxAttempts: 1 }, disabled: true }), weather('next'), node('e', 'end')],
      edges: [edge('s', 'bad'), edge('bad', 'next'), edge('next', 'e')],
    };
    const { runDoc, byId } = await run(wf, { city: 'Pune' });
    check('run succeeds even though the tool would always fail', runDoc.status === 'success', runDoc.status);
    check('the disabled tool never ran (no attempts logged as failures)', byId.bad.status === 'skipped' && !(byId.bad.logs || []).some((l) => /simulated failure/.test(l)));
    check('the next tool ran', byId.next.status === 'success', byId.next.status);
  }

  // ------------------------------------------------------------ C: positive branch
  console.log('\nC. multi-output nodes follow their positive branch');
  {
    const wf = {
      nodes: [
        node('s', 'start'),
        node('c', 'condition', { expression: 'false', disabled: true }),
        node('yes', 'transform', { mode: 'replace', mappings: [{ key: 'branch', value: 'true' }] }),
        node('no', 'transform', { mode: 'replace', mappings: [{ key: 'branch', value: 'false' }] }),
      ],
      edges: [edge('s', 'c'), edge('c', 'yes', { sourceHandle: 'true' }), edge('c', 'no', { sourceHandle: 'false' })],
    };
    const { byId } = await run(wf, { n: 1 });
    check('disabled condition takes the true branch (expression ignored)', byId.yes.status === 'success', byId.yes.status);
    check('its false branch is skipped', byId.no.status === 'skipped', byId.no.status);

    const wf2 = {
      nodes: [
        node('s', 'start'),
        node('a', 'approval', { title: 'Approve?', assignees: { userIds: [], roles: ['owner'] }, minApprovals: 1, disabled: true }),
        node('ok', 'transform', { mode: 'merge', mappings: [{ key: 'approved', value: 'yes' }] }),
        node('rej', 'transform', { mode: 'merge', mappings: [{ key: 'approved', value: 'no' }] }),
      ],
      edges: [edge('s', 'a'), edge('a', 'ok', { sourceHandle: 'approved' }), edge('a', 'rej', { sourceHandle: 'rejected' })],
    };
    const r2 = await run(wf2, { refund: 10 });
    check('disabled approval does not park the run', r2.runDoc.status === 'success', r2.runDoc.status);
    check('it follows the approved branch', r2.byId.ok.status === 'success' && r2.byId.rej.status === 'skipped', `${r2.byId.ok.status}/${r2.byId.rej.status}`);
  }

  // ------------------------------------------------------------ D: start/end
  console.log('\nD. Start and End ignore the flag');
  {
    const wf = { nodes: [node('s', 'start', { disabled: true }), node('e', 'end', { disabled: true })], edges: [edge('s', 'e')] };
    const { runDoc, byId } = await run(wf, { x: 1 });
    check('run succeeds', runDoc.status === 'success', runDoc.status);
    check('Start and End executed normally', byId.s.status === 'success' && byId.e.status === 'success' && !byId.e.skipReason);
  }

  // ------------------------------------------------------------ E: validation
  console.log('\nE. validation: a disabled node never blocks a run');
  {
    const nodes = [node('s', 'start'), weather('t', { integration: '', action: '', disabled: true }), node('e', 'end')];
    const edges = [edge('s', 't'), edge('t', 'e')];
    const enabled = validateGraph({ nodes: nodes.map((n) => (n.id === 't' ? weather('t', { integration: '', action: '' }) : n)), edges });
    const disabled = validateGraph({ nodes, edges });
    check('an unconfigured tool is an error while enabled', enabled.errors.some((p) => p.nodeId === 't'), JSON.stringify(enabled.errors.map((p) => p.id)));
    check('the same tool disabled: no errors or warnings for it', !disabled.errors.some((p) => p.nodeId === 't') && !disabled.warnings.some((p) => p.nodeId === 't'));
    check('its problems move to info, prefixed "(disabled)"', disabled.info.some((p) => p.nodeId === 't' && p.message.startsWith('(disabled)')));
    check('and a note says it passes through', disabled.info.some((p) => p.id === 'node-disabled:t'));
  }

  // ------------------------------------------------------------ F: collab op
  console.log('\nF. co-editing: toggling disabled is an ordinary node.update');
  {
    const doc = docFromWorkflow({ name: 'wf', nodes: [node('s', 'start'), node('t', 'transform', { mode: 'replace', mappings: [] })], edges: [edge('s', 't')] });
    const ctx = { permissions: new Set(['workflow:edit']), deletedIds: new Set(), lockedByOther: () => null };
    let ok = true;
    try {
      applyOp(doc, { type: 'node.update', nodeId: 't', path: ['disabled'], value: true }, ctx);
    } catch (err) {
      ok = false;
      console.log('      ', err.message);
    }
    const t = docToPlain(doc).nodes.find((n) => n.id === 't');
    check('the hub accepts path ["disabled"]', ok && t.data.config.disabled === true);
    applyOp(doc, { type: 'node.update', nodeId: 't', path: ['disabled'], unset: true }, ctx);
    check('and unsetting it re-enables the node', docToPlain(doc).nodes.find((n) => n.id === 't').data.config.disabled === undefined);
  }
} finally {
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
