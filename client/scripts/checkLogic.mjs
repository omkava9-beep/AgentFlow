/**
 * Client-side logic checks — the store, the graph validator and the cron helper.
 *
 *   npm run check:logic
 *
 * Plain Node, no test runner and no jsdom: everything here is deliberately pure
 * logic that runs outside React. Rendering and interaction are covered by driving
 * the real app in a browser instead.
 */
import { useWorkflowStore } from '../src/store/workflowStore.js';
import { validateGraph } from '../src/utils/validateGraph.js';
import { describeCron, nextRun, parseCron } from '../src/utils/cron.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '\u2713' : '\u2717'} ${name}${detail ? ` \u2014 ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

console.log('=== workflow store ===\n');
{
const S = () => useWorkflowStore.getState();
const load = (nodes = [], edges = []) => S().loadWorkflow({ _id: 'w1', name: 'wf', nodes, edges });
const node = (id, type, config = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { config } });
const select = (ids) => useWorkflowStore.setState({ nodes: S().nodes.map((n) => ({ ...n, selected: ids.includes(n.id) })) });

console.log('1. drag coalescing — one gesture, one history entry');
{
  load([node('a', 'agent'), node('b', 'agent')]);
  S().beginGesture();
  // simulate React Flow firing many position changes during one drag
  for (let i = 1; i <= 40; i++) S().onNodesChange([{ id: 'a', type: 'position', position: { x: i, y: i } }]);
  S().endGesture();
  check(`past length = ${S().past.length} (expect 1, not 40)`, S().past.length === 1);
  check('node moved', S().nodes.find((n) => n.id === 'a').position.x === 40);
  S().undo();
  check('undo restores pre-drag position in one step', S().nodes.find((n) => n.id === 'a').position.x === 0);
  check('dirty after undo', S().dirty === true);
}

console.log('\n1b. a click that moves nothing adds no history entry');
{
  load([node('a', 'agent')]);
  S().beginGesture();
  S().onNodesChange([{ id: 'a', type: 'select', selected: true }]);
  S().endGesture();
  check(`past length = ${S().past.length} (expect 0)`, S().past.length === 0);
  check('selection alone does not mark dirty', S().dirty === false);
}

console.log('\n2. delete 3 nodes, undo restores nodes AND edges');
{
  load(
    [node('a', 'agent'), node('b', 'tool', { toolType: 'calculator' }), node('c', 'agent'), node('d', 'end')],
    [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'b', target: 'c' }, { id: 'e3', source: 'c', target: 'd' }],
  );
  select(['a', 'b', 'c']);
  S().deleteSelection();
  check(`nodes ${S().nodes.length} (expect 1)`, S().nodes.length === 1);
  check(`edges ${S().edges.length} (expect 0 — cascaded)`, S().edges.length === 0);
  S().undo();
  check(`nodes restored: ${S().nodes.length}`, S().nodes.length === 4);
  check(`edges restored: ${S().edges.length}`, S().edges.length === 3);
}

console.log('\n3. duplicate a 2-node selection joined by an edge');
{
  load([node('a', 'agent'), node('b', 'tool', { toolType: 'calculator' }), node('x', 'end')],
       [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'b', target: 'x' }]);
  select(['a', 'b']);
  S().duplicateSelection();
  check(`nodes ${S().nodes.length} (expect 5)`, S().nodes.length === 5);
  check(`edges ${S().edges.length} (expect 3 — only the internal edge cloned)`, S().edges.length === 3);
  const clones = S().nodes.filter((n) => n.selected);
  check('clones are the new selection', clones.length === 2);
  check('clones offset from originals', clones.every((c) => c.position.x === 40));
  check('original untouched', S().nodes.find((n) => n.id === 'a').position.x === 0);
  const newEdge = S().edges.find((e) => e.id !== 'e1' && e.id !== 'e2');
  const cloneIds = clones.map((c) => c.id);
  check('cloned edge points at cloned nodes', cloneIds.includes(newEdge.source) && cloneIds.includes(newEdge.target));
}

console.log('\n4. deep copy — editing a clone must not touch the original');
{
  load([node('h', 'agent', { label: 'Router', isHandoff: true, candidates: ['alpha', 'beta'] })]);
  select(['h']);
  S().duplicateSelection();
  const clone = S().nodes.find((n) => n.selected);
  S().updateNodeConfig(clone.id, { candidates: ['gamma'] });
  const original = S().nodes.find((n) => n.id === 'h');
  check(`original candidates = ${JSON.stringify(original.data.config.candidates)} (expect alpha,beta)`,
        JSON.stringify(original.data.config.candidates) === '["alpha","beta"]');
  check('clone candidates changed', JSON.stringify(S().nodes.find((n) => n.id === clone.id).data.config.candidates) === '["gamma"]');
}

console.log('\n5. copy / paste twice yields two independent sets');
{
  load([node('a', 'agent')]);
  select(['a']);
  S().copySelection();
  S().paste();
  S().paste();
  check(`nodes ${S().nodes.length} (expect 3)`, S().nodes.length === 3);
  check('all ids unique', new Set(S().nodes.map((n) => n.id)).size === 3);
}

console.log('\n6. Start node is never duplicated');
{
  load([node('s', 'start')]);
  select(['s']);
  S().duplicateSelection();
  check(`still one start (${S().nodes.filter((n) => n.type === 'start').length})`, S().nodes.filter((n) => n.type === 'start').length === 1);
  check('explains why', /only have one Start/i.test(S().lastError || ''), S().lastError);
}

console.log('\n7. edge labels');
{
  load([node('a', 'agent'), node('b', 'agent'), node('c', 'condition'), node('d', 'agent')],
       [{ id: 'plain', source: 'a', target: 'b' }, { id: 'cond', source: 'c', target: 'd', sourceHandle: 'true', label: 'true' }]);
  S().setEdgeLabel('plain', 'escalate');
  check('plain edge renamed', S().edges.find((e) => e.id === 'plain').label === 'escalate');
  S().setEdgeLabel('cond', 'sneaky');
  check('condition edge refuses rename', S().edges.find((e) => e.id === 'cond').label === 'true');
}

console.log('\n8. typing coalesces into one history entry');
{
  load([node('a', 'tool', { label: '' })]);
  const before = S().past.length;
  for (const ch of ['W', 'We', 'Wea', 'Weat', 'Weath', 'Weathe', 'Weather']) S().updateNodeConfig('a', { label: ch });
  check(`past grew by ${S().past.length - before} (expect 1, not 7)`, S().past.length - before === 1);
  S().undo();
  check('one undo clears the whole typed word', S().nodes[0].data.config.label === '');
}

console.log('\n9. history is bounded at 50');
{
  load([node('a', 'agent')]);
  for (let i = 0; i < 80; i++) S().addNode('agent', { x: i, y: i });
  check(`past length = ${S().past.length} (expect 50)`, S().past.length === 50);
}

console.log('\n10. validateGraph');
{
  const v1 = validateGraph({ nodes: [], edges: [] });
  check('empty canvas is an error', v1.errors.some((e) => e.id === 'empty'));

  const v2 = validateGraph({ nodes: [node('t', 'tool', { label: 'T', toolType: '' })], edges: [] });
  check('missing Start is an error', v2.errors.some((e) => e.id === 'no-start'));
  check('unset toolType is a WARNING, not an error', v2.warnings.some((w) => w.id.startsWith('tool-unset')));

  const v3 = validateGraph({
    nodes: [node('s', 'start'), node('t', 'tool', { label: 'T', toolType: 'nope' }), node('e', 'end')],
    edges: [{ id: '1', source: 's', target: 't' }, { id: '2', source: 't', target: 'e' }],
    tools: [{ type: 'calculator', label: 'Calculator', configSchema: [] }],
  });
  check('unknown toolType warns', v3.warnings.some((w) => w.id.startsWith('tool-unknown')));
  check('no errors for an otherwise-valid graph', v3.errors.length === 0);

  const v4 = validateGraph({
    nodes: [node('s', 'start'), node('a', 'agent'), node('b', 'agent')],
    edges: [{ id: '1', source: 's', target: 'a' }, { id: '2', source: 'a', target: 'b' }, { id: '3', source: 'b', target: 'a' }],
  });
  check('cycle is an error', v4.errors.some((e) => e.id === 'cycle'));

  const v5 = validateGraph({
    nodes: [node('s', 'start'), node('c', 'condition', { label: 'C', expression: 'output >' }), node('e', 'end'), node('orphan', 'agent', { label: 'Orphan' })],
    edges: [{ id: '1', source: 's', target: 'c' }, { id: '2', source: 'c', target: 'e', sourceHandle: 'true' }],
  });
  check('invalid expression warns', v5.warnings.some((w) => w.id.startsWith('cond-invalid')));
  check('missing false branch warns', v5.warnings.some((w) => w.id.startsWith('cond-branch')));
  check('unreachable node warns', v5.warnings.some((w) => w.id.startsWith('unreachable')));

  const v6 = validateGraph({
    nodes: [node('s', 'start'), node('h', 'agent', { label: 'H', isHandoff: true, candidates: ['a', 'b'] }), node('x', 'agent'), node('e', 'end')],
    edges: [{ id: '1', source: 's', target: 'h' }, { id: '2', source: 'h', target: 'x', label: 'a' }, { id: '3', source: 'x', target: 'e' }],
  });
  check('handoff candidate/label mismatch warns', v6.warnings.some((w) => w.id.startsWith('handoff-mismatch')));
}
}

console.log('\n=== handoff candidates ===\n');
{
const S = () => useWorkflowStore.getState();
const node = (id, type, config = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { config } });
const cfg = (id) => S().nodes.find((n) => n.id === id).data.config;
const labels = () => S().edges.filter((e) => e.source === 'h').map((e) => e.label);

const setup = () =>
  S().loadWorkflow({
    _id: 'w', name: 'wf',
    nodes: [node('h', 'agent', { label: 'Router', isHandoff: true, candidates: ['alpha', 'beta'] }), node('a', 'agent'), node('b', 'agent')],
    edges: [{ id: 'e1', source: 'h', target: 'a', label: 'alpha' }, { id: 'e2', source: 'h', target: 'b', label: 'beta' }],
  });

console.log('1. renaming a candidate renames its edge label');
{
  setup();
  S().renameHandoffCandidate('h', 0, 'escalation');
  check('candidate renamed', cfg('h').candidates[0] === 'escalation', JSON.stringify(cfg('h').candidates));
  check('matching edge label followed', labels().includes('escalation'), JSON.stringify(labels()));
  check('the other edge untouched', labels().includes('beta'));
  check('no validation mismatch after rename', !validateGraph({ nodes: S().nodes, edges: S().edges }).warnings.some((w) => w.id.startsWith('handoff-mismatch')));
}

console.log('\n2. rename is undoable as one step and coalesces while typing');
{
  setup();
  const before = S().past.length;
  for (const v of ['a', 'al', 'alp', 'alph', 'alpha2']) S().renameHandoffCandidate('h', 0, v);
  check(`past grew by ${S().past.length - before} (expect 1)`, S().past.length - before === 1);
  S().undo();
  check('undo restores candidate', cfg('h').candidates[0] === 'alpha');
  check('undo restores edge label', labels().includes('alpha'), JSON.stringify(labels()));
}

console.log('\n3. adding a candidate does NOT invent an edge (drift is reported, not hidden)');
{
  setup();
  S().addHandoffCandidate('h');
  check(`3 candidates now: ${JSON.stringify(cfg('h').candidates)}`, cfg('h').candidates.length === 3);
  check('edges unchanged', S().edges.length === 2);
  const w = validateGraph({ nodes: S().nodes, edges: S().edges }).warnings;
  check('validation reports the mismatch', w.some((x) => x.id.startsWith('handoff-mismatch')));
}

console.log('\n4. removing a candidate leaves the edge alone (no silent rewiring)');
{
  setup();
  S().removeHandoffCandidate('h', 1);
  check(`candidates: ${JSON.stringify(cfg('h').candidates)}`, JSON.stringify(cfg('h').candidates) === '["alpha"]');
  check('orphaned edge label kept', labels().includes('beta'), JSON.stringify(labels()));
  const w = validateGraph({ nodes: S().nodes, edges: S().edges }).warnings;
  check('validation reports the orphan', w.some((x) => x.id.startsWith('handoff-mismatch')));
  S().undo();
  check('undo restores the candidate', cfg('h').candidates.length === 2);
}

console.log('\n5. a clean handoff graph has no handoff warnings');
{
  setup();
  const v = validateGraph({
    nodes: [node('s', 'start'), ...S().nodes, node('e', 'end')],
    edges: [{ id: 'x', source: 's', target: 'h' }, ...S().edges, { id: 'y', source: 'a', target: 'e' }, { id: 'z', source: 'b', target: 'e' }],
  });
  check('no handoff warnings', !v.warnings.some((w) => w.id.startsWith('handoff')), JSON.stringify(v.warnings.map((w) => w.id)));
  check('no errors', v.errors.length === 0);
}

console.log('\n6. turning handoff off keeps candidates (toggling back is lossless)');
{
  setup();
  S().updateNodeConfig('h', { isHandoff: false });
  check('candidates preserved', cfg('h').candidates.length === 2);
  const w = validateGraph({ nodes: S().nodes, edges: S().edges }).warnings;
  check('no handoff warnings while disabled', !w.some((x) => x.id.startsWith('handoff')));
}
}

console.log('\n=== cron helper ===\n');
{
  console.log('validation');
  check('*/5 * * * * valid', parseCron('*/5 * * * *').valid);
  check('garbage invalid', !parseCron('not a cron').valid);
  check('too few fields invalid', !parseCron('* * *').valid);
  check('minute 60 invalid', !parseCron('60 * * * *').valid);
  check('hour 24 invalid', !parseCron('0 24 * * *').valid);
  check('reversed range invalid', !parseCron('0 10-5 * * *').valid);
  check('6-field accepted and flagged', parseCron('*/2 * * * * *').valid && parseCron('*/2 * * * * *').hasSeconds);

  console.log('\ndescriptions');
  const cases = [
    ['* * * * *', 'every minute'],
    ['*/5 * * * *', 'every 5 minutes'],
    ['30 * * * *', 'hourly at :30'],
    ['0 3 * * *', 'at 03:00 every day'],
    ['0 9 * * 1', 'at 09:00 on Monday'],
    ['0 0 1 * *', 'at 00:00 on day 1 of the month'],
    ['0 */6 * * *', 'every 6 hours at :00'],
    ['*/2 * * * * *', 'every 2 seconds'],
    ['* * * * * *', 'every second'],
    ['0 9 * * 1-5', 'at 09:00 on Monday, Tuesday, Wednesday, Thursday and Friday'],
    ['0 12 1 1 *', 'at 12:00 on day 1 of the month in January'],
  ];
  for (const [expr, expected] of cases) {
    const got = describeCron(expr);
    check(`${expr.padEnd(15)}-> ${got}`, got === expected, got === expected ? '' : `expected: ${expected}`);
  }

  console.log('\nnext run (from 2026-08-21 10:17 local)');
  const from = new Date('2026-08-21T10:17:00');
  check('every minute -> 10:18', nextRun('* * * * *', from).getMinutes() === 18);
  const hourly = nextRun('30 * * * *', from);
  check('hourly :30 -> 10:30', hourly.getHours() === 10 && hourly.getMinutes() === 30);
  const daily = nextRun('0 3 * * *', from);
  check('daily 03:00 -> tomorrow 03:00', daily.getDate() === 22 && daily.getHours() === 3);
  const weekly = nextRun('0 9 * * 1', from);
  check('Mondays 09:00 -> Mon 24 Aug', weekly.getDay() === 1 && weekly.getDate() === 24);
  check('sub-minute -> null', nextRun('*/2 * * * * *', from) === null);
}

console.log('\n=== tool config validation (spec/21) ===\n');
{
  const n = (id, type, config = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { config } });
  const TOOLS = [
    { type: 'calculator', label: 'Calculator', configSchema: [{ key: 'expression', label: 'Expression', type: 'text' }] },
    { type: 'send-email', label: 'Send Email', configSchema: [
      { key: 'to', label: 'To', type: 'text', required: true },
      { key: 'subject', label: 'Subject', type: 'text', default: '(no subject)' },
    ] },
  ];
  const graph = (toolConfig, toolType = 'send-email') => ({
    nodes: [n('s', 'start'), n('t', 'tool', { label: 'Mailer', toolType, toolConfig }), n('e', 'end')],
    edges: [{ id: '1', source: 's', target: 't' }, { id: '2', source: 't', target: 'e' }],
    tools: TOOLS,
  });

  let v = validateGraph(graph({}));
  check('missing required field warns', v.warnings.some((w) => w.id.startsWith('tool-field') && /"To"/.test(w.message)),
        JSON.stringify(v.warnings.map((w) => w.message)));
  check('it is a warning, not an error', v.errors.length === 0);

  v = validateGraph(graph({ to: 'a@b.c' }));
  check('required field satisfied -> no field warning', !v.warnings.some((w) => w.id.startsWith('tool-field')),
        JSON.stringify(v.warnings.map((w) => w.message)));

  v = validateGraph(graph({ to: '   ' }));
  check('whitespace does not satisfy a required field', v.warnings.some((w) => w.id.startsWith('tool-field')));

  v = validateGraph(graph({}, 'calculator'));
  check('optional-only schema -> no field warnings', !v.warnings.some((w) => w.id.startsWith('tool-field')));

  v = validateGraph(graph({}, 'retired-tool'));
  check('unknown tool type still warns', v.warnings.some((w) => w.id.startsWith('tool-unknown')));
  check('unknown type suppresses field checks', !v.warnings.some((w) => w.id.startsWith('tool-field')));

  const noTools = validateGraph({ ...graph({}), tools: null });
  check('tools not loaded yet -> no unknown/field noise',
        !noTools.warnings.some((w) => w.id.startsWith('tool-unknown') || w.id.startsWith('tool-field')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
