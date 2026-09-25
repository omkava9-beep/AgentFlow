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
import { normalizeToolConfig, normalizeToolNodes, LEGACY_TOOL_MAP } from '../src/utils/normalizeToolConfig.js';
import { predictMode, jsonParamError, looksLikeSecret, groupByCategory } from '../src/utils/integrationCatalog.js';
import { applyOp, ops as collabOps, diffConfig, deepEqual } from '../src/collab/ops.js';
import { OpClient } from '../src/collab/opClient.js';
import { getOpClient } from '../src/store/workflowStore.js';
import { mapInputSchema, schemaError, jsonFieldError, toolToAction, annotationBadges, actionHasSideEffect } from '../src/utils/mcpSchema.js';
import { mcpPayload, mcpFormError } from '../src/utils/mcpConnection.js';

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
  // spec/26 made a tool node with no integration/action an error (it was a
  // phase-2 warning): there is nothing the engine could run.
  check('unset integration is an ERROR (spec/26)', v2.errors.some((e) => e.id.startsWith('tool-unset')));

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

console.log('\n=== legacy tool configs (spec/26 §6) ===\n');
{
  const cases = [
    ['fake-weather', 'builtin', 'fake-weather'],
    ['calculator', 'builtin', 'calculator'],
    ['fake-search', 'builtin', 'fake-search'],
    ['send-email', 'email', 'send'],
    ['slack-message', 'slack', 'post_message'],
    ['http-request', 'http', 'request'],
    ['database-write', 'database', 'insert'],
    ['retired-tool', 'builtin', 'retired-tool'],
  ];
  for (const [toolType, integration, action] of cases) {
    const got = normalizeToolConfig({ label: 'X', toolType, toolConfig: { a: 1 }, mockOverrides: { failureRate: 0.2 } });
    check(`${toolType.padEnd(15)}-> ${got.integration}.${got.action}`,
      got.integration === integration && got.action === action && got.params.a === 1 && got.connectionId === null
        && !('toolType' in got) && !('toolConfig' in got) && got.mockOverrides.failureRate === 0.2 && got.label === 'X');
  }
  check('mapping table covers all seven phase-2 tools', Object.keys(LEGACY_TOOL_MAP).length === 7);
  const unset = normalizeToolConfig({ label: 'New Tool', toolType: '' });
  check('unset legacy type stays unset', unset.integration === '' && unset.action === '');
  const both = normalizeToolConfig({ toolType: 'calculator', toolConfig: { x: 1 }, integration: 'slack', action: 'post_message', params: { channel: '#a' } });
  check('integration wins over toolType, legacy keys dropped',
    both.integration === 'slack' && both.params.channel === '#a' && !('toolType' in both));
  const modern = { label: 'M', integration: 'http', action: 'request', connectionId: 'sandbox', params: { url: 'x' } };
  check('already-normalised config is unchanged', JSON.stringify(normalizeToolConfig(modern)) === JSON.stringify(modern));
  const [t, a] = normalizeToolNodes([
    { id: 't', type: 'tool', data: { config: { toolType: 'http-request', toolConfig: { url: 'u' } } } },
    { id: 'a', type: 'agent', data: { config: { label: 'A', toolType: 'not-touched' } } },
  ]);
  check('normalizeToolNodes rewrites tool nodes only', t.data.config.integration === 'http' && a.data.config.toolType === 'not-touched');

  const S = () => useWorkflowStore.getState();
  S().loadWorkflow({ _id: 'w2', name: 'legacy', nodes: [{ id: 'x', type: 'tool', position: { x: 0, y: 0 }, data: { config: { label: 'Mail', toolType: 'send-email', toolConfig: { to: 'a@b.c' } } } }], edges: [] });
  const loaded = S().nodes[0].data.config;
  check('store normalises legacy tool nodes on load', loaded.integration === 'email' && loaded.action === 'send' && loaded.params.to === 'a@b.c');
  S().addNode('tool', { x: 0, y: 0 });
  const fresh = S().nodes.at(-1).data.config;
  check('new tool nodes use the spec/26 shape', fresh.integration === '' && fresh.action === '' && fresh.connectionId === null && !('toolType' in fresh));
}

console.log('\n=== integration mode prediction (spec/26 §3) ===\n');
{
  const slack = { id: 'slack', auth: { type: 'webhookUrl' } };
  const http = { id: 'http', auth: { type: 'none' } };
  const jira = { id: 'jira', auth: { type: 'apiKey' } };
  const liveAct = { id: 'a', live: true };
  const sandboxOnly = { id: 'b', live: false };
  const liveConn = { id: 'c1', mode: 'live' };
  const sandConn = { id: 'c2', mode: 'sandbox' };
  const cases = [
    ['Slack, live connection', { integration: slack, action: liveAct, connectionId: 'c1', connection: liveConn }, 'live'],
    ['Slack, no connection', { integration: slack, action: liveAct, connectionId: null }, 'sandbox'],
    ["Slack, connectionId 'sandbox'", { integration: slack, action: liveAct, connectionId: 'sandbox' }, 'sandbox'],
    ['Slack, sandbox-mode connection', { integration: slack, action: liveAct, connectionId: 'c2', connection: sandConn }, 'sandbox'],
    ['HTTP, no connection (C3)', { integration: http, action: liveAct, connectionId: null }, 'live'],
    ['HTTP, live bearer connection', { integration: http, action: liveAct, connectionId: 'c1', connection: liveConn }, 'live'],
    ["HTTP, connectionId 'sandbox'", { integration: http, action: liveAct, connectionId: 'sandbox' }, 'sandbox'],
    ['any node, liveEnabled false', { integration: http, action: liveAct, connectionId: null, liveEnabled: false }, 'sandbox'],
    ['Jira (no live adapter)', { integration: jira, action: sandboxOnly, connectionId: 'c1', connection: liveConn }, 'sandbox'],
    ['connection not loaded yet', { integration: slack, action: liveAct, connectionId: 'c9' }, 'unknown'],
    ['liveCapable alias honoured', { integration: http, action: { id: 'x', liveCapable: true }, connectionId: null }, 'live'],
  ];
  for (const [name, args, expected] of cases) {
    const got = predictMode(args);
    check(`${name.padEnd(32)}-> ${got}`, got === expected, got === expected ? '' : `expected ${expected}`);
  }
}

console.log('\n=== integration params & validation (spec/25, spec/26) ===\n');
{
  check('empty json param is valid', jsonParamError('') === null);
  check('valid json param', jsonParamError('{"a": 1}') === null);
  check('placeholders inside json are tolerated', jsonParamError('{"id": "{{input.id}}", "n": {{input.count}}}') === null);
  check('broken json param reports an error', /Invalid JSON/.test(jsonParamError('{"a": ')));
  check('slack bot token looks like a secret', looksLikeSecret('xoxb-123-abc'));
  check('Bearer header looks like a secret', looksLikeSecret('Bearer abc.def'));
  check('plain text is not a secret', !looksLikeSecret('#alerts'));

  const CATALOG = [
    { id: 'slack', name: 'Slack', category: 'communication', auth: { type: 'webhookUrl', fields: [{ key: 'webhookUrl', secret: true, required: true }] },
      actions: [{ id: 'post_message', name: 'Post message', live: true, configSchema: [{ key: 'channel', label: 'Channel', type: 'text', required: true }, { key: 'text', label: 'Text', type: 'textarea' }] }] },
    { id: 'http', name: 'HTTP Request', category: 'web', auth: { type: 'none', fields: [] },
      actions: [{ id: 'request', name: 'Request', live: true, configSchema: [{ key: 'url', label: 'URL', type: 'text', required: true }, { key: 'headers', label: 'Headers', type: 'json' }] }] },
    { id: 'mcp', name: 'MCP', category: 'ai', dynamicActions: true, auth: { type: 'custom', fields: [] }, actions: [] },
  ];
  const n = (id, type, config = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { config } });
  const g = (config, connections = null) => ({
    nodes: [n('s', 'start'), n('t', 'tool', { label: 'T', ...config }), n('e', 'end')],
    edges: [{ id: '1', source: 's', target: 't' }, { id: '2', source: 't', target: 'e' }],
    integrations: CATALOG,
    connections,
  });
  const ids = (v, key) => v[key].map((x) => x.id.split(':')[0]);

  let v = validateGraph(g({ integration: 'slack', action: '' }));
  check('missing action is an error', ids(v, 'errors').includes('tool-unset'));

  v = validateGraph(g({ integration: 'nope', action: 'x' }));
  check('unknown integration is a warning (raw kept)', ids(v, 'warnings').includes('tool-unknown') && !v.errors.length);

  v = validateGraph(g({ integration: 'slack', action: 'gone' }));
  check('unknown action is a warning', ids(v, 'warnings').includes('tool-unknown-action'));

  v = validateGraph(g({ integration: 'mcp', action: 'discovered_tool', connectionId: 'c1' }, []));
  check('dynamic-action integration: unlisted action is not flagged', !ids(v, 'warnings').includes('tool-unknown-action'));

  v = validateGraph(g({ integration: 'slack', action: 'post_message', params: {} }));
  check('required param empty -> warning', ids(v, 'warnings').includes('tool-field'));
  check('credentialed integration without connection -> info, not warning',
    ids(v, 'info').includes('tool-noconn') && !ids(v, 'warnings').includes('tool-noconn'));

  v = validateGraph(g({ integration: 'http', action: 'request', params: { url: 'https://x.dev' } }));
  check('auth:none integration without connection -> no info', !ids(v, 'info').includes('tool-noconn'));

  v = validateGraph(g({ integration: 'http', action: 'request', params: { url: 'https://x.dev', headers: '{ bad' } }));
  check('invalid json param -> warning', ids(v, 'warnings').includes('tool-json'));

  v = validateGraph(g({ integration: 'http', action: 'request', params: { url: 'https://x.dev', headers: '{"Authorization": "x"}', body: 'Bearer abc' } }));
  check('schema fields only are secret-scanned', !ids(v, 'warnings').includes('tool-secret'));
  v = validateGraph(g({ integration: 'slack', action: 'post_message', params: { channel: 'xoxb-1-2' } }));
  check('token pasted into a param -> warning', ids(v, 'warnings').includes('tool-secret'));

  const conns = [{ id: 'c1', integration: 'slack', name: 'Alerts', status: 'error' }, { id: 'c2', integration: 'github', name: 'GH', status: 'ok' }];
  v = validateGraph(g({ integration: 'slack', action: 'post_message', params: { channel: '#a' }, connectionId: 'c1' }, conns));
  check('connection with failing test -> warning', ids(v, 'warnings').includes('tool-conn-error'));
  v = validateGraph(g({ integration: 'slack', action: 'post_message', params: { channel: '#a' }, connectionId: 'zzz' }, conns));
  check('dangling connection id -> warning', ids(v, 'warnings').includes('tool-conn-missing'));
  v = validateGraph(g({ integration: 'slack', action: 'post_message', params: { channel: '#a' }, connectionId: 'c2' }, conns));
  check('connection for another integration -> warning', ids(v, 'warnings').includes('tool-conn-mismatch'));
  v = validateGraph(g({ integration: 'slack', action: 'post_message', params: { channel: '#a' }, connectionId: 'zzz' }, null));
  check('connections not loaded -> no connection noise', !v.warnings.some((w) => w.id.startsWith('tool-conn')));
  v = validateGraph(g({ integration: 'slack', action: 'post_message', params: { channel: '#a' }, connectionId: 'sandbox' }, conns));
  check("'sandbox' connection is always valid", !v.warnings.length && !v.info.length && !v.errors.length,
    JSON.stringify([...v.warnings, ...v.info]));

  v = validateGraph({ nodes: [n('s', 'start'), n('t', 'tool', { label: 'T', toolType: 'send-email', toolConfig: {} }), n('e', 'end')],
    edges: [{ id: '1', source: 's', target: 't' }, { id: '2', source: 't', target: 'e' }], integrations: null });
  check('legacy node with catalogue not loaded -> no false positives', !v.errors.length && !v.warnings.length);

  const grouped = groupByCategory(CATALOG, 'sla');
  check('category grouping + search', grouped.length === 1 && grouped[0].items[0].id === 'slack' && grouped[0].label === 'Communication');
}


console.log('\n=== live collaboration (spec/28) ===\n');
{
  const N = (id, type = 'agent', config = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { config: { label: id, ...config } } });
  const doc0 = () => ({ name: 'wf', nodes: [N('a'), N('b'), N('c')], edges: [{ id: 'ab', source: 'a', target: 'b' }] });

  console.log('1. op rules mirror the server');
  {
    const d = doc0();
    check('edge that closes a cycle -> cycle', applyOp({ ...d, edges: [...d.edges, { id: 'bc', source: 'b', target: 'c' }] }, collabOps.edgeAdd({ id: 'ca', source: 'c', target: 'a' })).reason === 'cycle');
    const s1 = applyOp(d, collabOps.nodeAdd(N('s', 'start'))).doc;
    check('second Start node -> invalid', applyOp(s1, collabOps.nodeAdd(N('s2', 'start'))).reason === 'invalid');
    const del = applyOp(d, collabOps.nodeDelete('a'));
    check('node.delete cascades its edges', del.ok && del.doc.edges.length === 0 && del.cascade?.edgeIds?.[0] === 'ab');
    const bad = applyOp(d, collabOps.batch([collabOps.nodeUpdate('a', ['label'], 'X'), collabOps.nodeUpdate('zzz', ['label'], 'Y')]));
    check('batch is atomic: one bad part rejects all', !bad.ok && bad.reason === 'not_found');
    check('__proto__ path -> invalid', applyOp(d, collabOps.nodeUpdate('a', ['__proto__', 'x'], 1)).reason === 'invalid');
    check('update on condition edge label refused', applyOp({ ...d, edges: [{ id: 'ct', source: 'a', target: 'b', sourceHandle: 'true', label: 'true' }] }, collabOps.edgeUpdate('ct', 'no')).reason === 'invalid');
    const changes = diffConfig({ label: 'T', params: { city: 'Pune', units: 'c' } }, { label: 'T', params: { city: 'Goa', units: 'c' } });
    check('nested params diff down to the changed leaf', changes.length === 1 && JSON.stringify(changes[0].path) === '["params","city"]', JSON.stringify(changes));
    check('arrays are values, not merged', JSON.stringify(diffConfig({ candidates: ['a', 'b'] }, { candidates: ['a'] })[0].path) === '["candidates"]');
  }

  console.log('\n2. optimistic apply, rebase on a remote op, ack confirms');
  {
    const sent = [];
    const c = new OpClient({ send: (op) => sent.push(op) });
    c.reset(doc0(), { seq: 10, sessionId: 's1' });
    c.ready = true;
    c.local(collabOps.nodeUpdate('a', ['label'], 'Mine'));
    c.flush();
    check('local edit is visible immediately', c.view.nodes[0].data.config.label === 'Mine');
    check('confirmed is untouched until the ack', c.confirmed.nodes[0].data.config.label === 'a');
    c.remote({ seq: 11, op: { ...collabOps.nodeUpdate('b', ['systemPrompt'], 'Theirs'), opId: 'r1' }, by: { userId: 'u2' } });
    check('remote op on another node lands in confirmed', c.confirmed.nodes[1].data.config.systemPrompt === 'Theirs');
    check('pending replays on top (both edits visible)', c.view.nodes[0].data.config.label === 'Mine' && c.view.nodes[1].data.config.systemPrompt === 'Theirs');
    c.ack(sent[0].opId, { ok: true, seq: 12 });
    check('ack moves it into confirmed at its seq', c.confirmedSeq === 12 && c.pendingCount === 0 && c.confirmed.nodes[0].data.config.label === 'Mine');
    let gap = null;
    c.onGap = (g) => { gap = g; };
    c.remote({ seq: 14, op: { ...collabOps.rename('x'), opId: 'r2' }, by: {} });
    check('a seq gap asks for a resync instead of applying', gap?.reason === 'broadcast-gap' && c.confirmedSeq === 12 && c.view.name === 'wf');
  }

  console.log('\n3. reject rolls the optimistic edit back');
  {
    const sent = [];
    let rejected = null;
    const c = new OpClient({ send: (op) => sent.push(op), onReject: (op, ack) => { rejected = ack.reason; } });
    c.reset(doc0(), { seq: 1 });
    c.ready = true;
    c.local(collabOps.nodeDelete('c'));
    check('delete shows immediately', c.view.nodes.length === 2);
    c.ack(sent[0].opId, { ok: false, reason: 'locked' });
    check('rejected -> node is back, nothing pending', c.view.nodes.length === 3 && c.pendingCount === 0);
    check('the reject reason reaches the UI', rejected === 'locked');
  }

  console.log('\n4. typing is coalesced; catch-up dedupes a resent op');
  {
    const sent = [];
    const c = new OpClient({ send: (op) => sent.push(op), throttleMs: 1e9 });
    c.reset(doc0(), { seq: 5, sessionId: 's1' });
    c.ready = true;
    for (const v of ['W', 'We', 'Wea', 'Weather']) c.local(collabOps.nodeUpdate('a', ['label'], v));
    check('four keystrokes -> one pending op', c.pendingCount === 1);
    c.flush();
    check('only the final value is sent', sent.length === 1 && sent[0].value === 'Weather');
    // The connection drops before the ack; on reconnect the server's catch-up
    // already contains that op (it was applied) - it must not be sent again.
    c.disconnected();
    c.catchUp({ sessionId: 's1', ops: [{ seq: 6, op: sent[0], by: { userId: 'me' } }] });
    check('catch-up retires the op it already applied', c.pendingCount === 0 && c.confirmedSeq === 6 && sent.length === 1);
    c.ack(sent[0].opId, { ok: true, seq: 6 });
    check('a late duplicate ack is harmless', c.confirmedSeq === 6 && c.view.nodes[0].data.config.label === 'Weather');
  }

  console.log('\n5. per-user undo never clobbers a collaborator');
  {
    const S = () => useWorkflowStore.getState();
    S().loadWorkflow({ _id: 'wu', name: 'wf', draftSeq: 0, nodes: [N('a', 'agent', { systemPrompt: '' })], edges: [] });
    const c = getOpClient();
    const sent = [];
    c.send = (op) => sent.push(op);
    c.ready = true;
    S().updateNodeConfig('a', { label: 'Mine', systemPrompt: 'P' });
    c.flush();
    c.ack(sent[0].opId, { ok: true, seq: 1 });
    S().applyRemote({ seq: 2, op: { ...collabOps.nodeUpdate('a', ['label'], 'Theirs'), opId: 'x' }, by: { userId: 'bob' } });
    check('remote label change applied', S().nodes[0].data.config.label === 'Theirs');
    S().undo();
    c.flush(); // node.update is throttled (150 ms trailing); send it now
    const cfg = S().nodes[0].data.config;
    check('undo reverts my untouched field', cfg.systemPrompt === '');
    check("undo skips the field Bob changed after me", cfg.label === 'Theirs');
    check('the undo went out as a new op', sent.length === 2 && sent[1].type === 'node.update' && JSON.stringify(sent[1].path) === '["systemPrompt"]');

    S().loadWorkflow({ _id: 'wd', name: 'wf', nodes: [N('a'), N('b'), N('c')], edges: [{ id: 'ab', source: 'a', target: 'b' }, { id: 'bc', source: 'b', target: 'c' }] });
    useWorkflowStore.setState({ nodes: S().nodes.map((n) => ({ ...n, selected: n.id === 'b' })) });
    S().deleteSelection();
    check('delete cascades', S().nodes.length === 2 && S().edges.length === 0);
    S().undo();
    check('undo restores the node with its ORIGINAL id and both edges', S().nodes.some((n) => n.id === 'b') && S().edges.length === 2);
  }

  console.log('\n6. two clients converge through a serial server (randomised)');
  {
    // A tiny stand-in for the hub: serial apply with the same rules, seq per
    // op, ack to the sender, broadcast to the rest, FIFO per link.
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];

    for (let round = 0; round < 25; round++) {
      const server = { doc: doc0(), seq: 0, applied: new Set() };
      const links = { A: { up: [], down: [] }, B: { up: [], down: [] } };
      const clients = {};
      for (const id of ['A', 'B']) {
        const c = new OpClient({ send: (op) => links[id].up.push(op), throttleMs: 1e9 });
        c.reset(doc0(), { seq: 0, sessionId: 'sim' });
        c.ready = true;
        clients[id] = c;
      }
      const serverReceive = (from, op) => {
        const r = applyOp(server.doc, op);
        if (!r.ok) return links[from].down.push({ kind: 'ack', opId: op.opId, ack: { ok: false, reason: r.reason } });
        server.doc = r.doc;
        server.seq += 1;
        links[from].down.push({ kind: 'ack', opId: op.opId, ack: { ok: true, seq: server.seq } });
        for (const other of Object.keys(links)) if (other !== from) links[other].down.push({ kind: 'op', payload: { seq: server.seq, op, by: { userId: from } } });
      };
      const deliverOne = () => {
        const ready = [];
        for (const id of Object.keys(links)) {
          if (links[id].up.length) ready.push(['up', id]);
          if (links[id].down.length) ready.push(['down', id]);
        }
        if (!ready.length) return false;
        const [dir, id] = pick(ready);
        if (dir === 'up') serverReceive(id, links[id].up.shift());
        else {
          const msg = links[id].down.shift();
          if (msg.kind === 'ack') clients[id].ack(msg.opId, msg.ack);
          else clients[id].remote(msg.payload);
        }
        return true;
      };
      const randomOp = (c) => {
        const nodes = c.view.nodes;
        const r = rand();
        if (!nodes.length || r < 0.15) return collabOps.nodeAdd(N(`n${round}-${Math.floor(rand() * 1e6)}`));
        const a = pick(nodes).id;
        if (r < 0.45) return collabOps.nodeUpdate(a, [pick(['label', 'systemPrompt'])], `v${Math.floor(rand() * 100)}`);
        if (r < 0.6) return collabOps.nodeMove(a, { x: Math.floor(rand() * 500), y: Math.floor(rand() * 500) });
        if (r < 0.8) return collabOps.edgeAdd({ id: `e${Math.floor(rand() * 1e6)}`, source: a, target: pick(nodes).id });
        if (r < 0.9) return collabOps.nodeDelete(a);
        return collabOps.rename(`name-${Math.floor(rand() * 10)}`);
      };
      for (let step = 0; step < 60; step++) {
        if (rand() < 0.5) {
          const c = clients[pick(['A', 'B'])];
          c.local(randomOp(c));
          c.flush();
        }
        if (rand() < 0.7) deliverOne();
      }
      while (deliverOne());
      const same = deepEqual(clients.A.view, server.doc) && deepEqual(clients.B.view, server.doc);
      if (!same || clients.A.pendingCount || clients.B.pendingCount) {
        check(`round ${round}: clients converge on the server document`, false,
          `A pending ${clients.A.pendingCount}, B pending ${clients.B.pendingCount}`);
        break;
      }
      if (round === 24) check('25 randomised rounds: both clients equal the server doc, nothing left pending', true);
    }
  }
}

console.log('\n=== advanced node validation (spec/31) ===\n');
{
  const n = (id, type, config = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { config: { label: id, ...config } } });
  const e = (source, target, extra = {}) => ({ id: `${source}-${target}-${extra.sourceHandle || ''}`, source, target, ...extra });
  const base = (mid, extraEdges = []) => ({ nodes: [n('s', 'start'), ...mid, n('end', 'end')], edges: extraEdges });
  const ids = (v, kind) => [...v.errors, ...v.warnings].filter((x) => x.id.startsWith(kind)).length;

  let v = validateGraph({ ...base([n('c', 'condition', { expression: 'true' })]), edges: [e('s', 'c'), e('c', 'end', { sourceHandle: 'error' })] });
  check('error edge from a condition is an error', v.errors.some((x) => x.id.startsWith('error-edge')));
  v = validateGraph({ ...base([n('t', 'tool', { integration: 'builtin', action: 'fake-weather' })]), edges: [e('s', 't'), e('t', 'end'), e('t', 'end', { sourceHandle: 'error' })] });
  check('error edge from a tool is allowed', !v.errors.some((x) => x.id.startsWith('error-edge')));

  v = validateGraph({ ...base([n('x', 'transform', { mappings: [] })]), edges: [e('s', 'x'), e('x', 'end')] });
  check('transform with no mappings warns', ids(v, 'transform-empty') === 1);
  v = validateGraph({ ...base([n('x', 'transform', { mappings: [{ key: 'a', value: '1' }, { key: 'a', value: '2' }] })]), edges: [e('s', 'x'), e('x', 'end')] });
  check('transform with a duplicate key warns', ids(v, 'transform-dup') === 1);

  v = validateGraph({ ...base([n('c', 'code', { source: 'return (' })]), edges: [e('s', 'c'), e('c', 'end')] });
  check("code that doesn't parse warns", ids(v, 'code-invalid') === 1);
  v = validateGraph({ ...base([n('c', 'code', { source: 'return input;' })]), edges: [e('s', 'c'), e('c', 'end')] });
  check('valid code has no code warnings', ids(v, 'code-') === 0);

  v = validateGraph({ ...base([n('d', 'delay', { mode: 'duration', durationMs: 0 })]), edges: [e('s', 'd'), e('d', 'end')] });
  check('zero delay warns', ids(v, 'delay-zero') === 1);
  v = validateGraph({ ...base([n('d', 'delay', { mode: 'duration', durationMs: 25 * 3600 * 1000 })]), edges: [e('s', 'd'), e('d', 'end')] });
  check('delay over 24h warns', ids(v, 'delay-long') === 1);

  const workflows = [{ _id: 'w-body', name: 'Body' }, { _id: 'w-self', name: 'Me' }];
  v = validateGraph({ ...base([n('l', 'loop', { itemsPath: '{{input.items}}', workflowId: '' })]), edges: [e('s', 'l'), e('l', 'end')], workflows });
  check('loop with no body warns', ids(v, 'loop-unset') === 1);
  v = validateGraph({ ...base([n('l', 'loop', { itemsPath: '{{input.items}}', workflowId: 'w-gone' })]), edges: [e('s', 'l'), e('l', 'end')], workflows });
  check('loop pointing at a deleted workflow warns', ids(v, 'loop-missing') === 1);
  v = validateGraph({ ...base([n('sw', 'subworkflow', { workflowId: 'w-self' })]), edges: [e('s', 'sw'), e('sw', 'end')], workflows, currentWorkflowId: 'w-self' });
  check('sub-workflow calling itself warns about recursion', ids(v, 'subworkflow-self') === 1);
  v = validateGraph({ ...base([n('l', 'loop', { itemsPath: '{{input.items}}', workflowId: 'w-body', concurrency: 20 })]), edges: [e('s', 'l'), e('l', 'end')], workflows });
  check('loop concurrency outside 1–10 warns', ids(v, 'loop-concurrency') === 1);
  v = validateGraph({ ...base([n('l', 'loop', { itemsPath: '{{input.items}}', workflowId: 'w-body' })]), edges: [e('s', 'l'), e('l', 'end')], workflows: null });
  check('workflow list not loaded yet → no missing-workflow warning', ids(v, 'loop-missing') === 0);

  v = validateGraph({ ...base([n('m', 'merge', { mode: 'any' })]), edges: [e('s', 'm'), e('m', 'end')] });
  check('merge with one incoming branch warns', ids(v, 'merge-inputs') === 1);
  v = validateGraph({ ...base([n('a', 'transform', { mappings: [{ key: 'a', value: '1' }] }), n('b', 'transform', { mappings: [{ key: 'b', value: '1' }] }), n('m', 'merge')]),
    edges: [e('s', 'a'), e('s', 'b'), e('a', 'm'), e('b', 'm'), e('m', 'end')] });
  check('merge with two branches is clean', ids(v, 'merge-') === 0 && v.errors.length === 0);
}

console.log('\n=== MCP tools & agent tools (spec/37) ===\n');
{
  const schema = {
    type: 'object',
    required: ['id', 'tags'],
    properties: {
      id: { type: 'integer', minimum: 1, description: 'Customer id' },
      email: { type: 'string', format: 'email' },
      body: { type: 'string', description: 'The message body' },
      tier: { type: 'string', enum: ['free', 'gold'] },
      vip: { type: 'boolean', default: false },
      tags: { type: 'array', items: { type: 'string' } },
      address: { type: 'object', required: ['city'], properties: { city: { type: 'string' } } },
      pick: { oneOf: [{ type: 'string' }, { type: 'number' }] },
    },
  };
  const { configSchema, jsonEditor } = mapInputSchema(schema);
  const byKey = Object.fromEntries(configSchema.map((f) => [f.key, f]));
  check('flat object schema renders a form (no whole-args editor)', jsonEditor === false && configSchema.length === 8);
  check('integer → number with minimum carried over', byKey.id.type === 'number' && byKey.id.min === 1 && byKey.id.required === true);
  check('string with format email gets a placeholder hint', byKey.email.type === 'text' && byKey.email.placeholder === 'name@example.com');
  check('string described as a body → textarea', byKey.body.type === 'textarea');
  check('string enum → select with its options', byKey.tier.type === 'select' && byKey.tier.options.map((o) => o.value).join() === 'free,gold');
  check('boolean keeps its default', byKey.vip.type === 'boolean' && byKey.vip.default === false);
  check('array / object / oneOf → JSON editor carrying its sub-schema', ['tags', 'address', 'pick'].every((k) => byKey[k].type === 'json' && byKey[k].schema));
  check('required[] marks exactly the required fields', configSchema.filter((f) => f.required).map((f) => f.key).sort().join() === 'id,tags');

  const many = { type: 'object', properties: Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`p${i}`, { type: 'string' }])) };
  check('> 25 properties → one JSON editor for the whole object, under __args like the server', mapInputSchema(many).jsonEditor === true && mapInputSchema(many).configSchema[0]?.key === '__args');
  check('top-level oneOf → whole-args editor', mapInputSchema({ oneOf: [{ type: 'object' }] }).jsonEditor === true);
  check('a non-object schema → one JSON editor', mapInputSchema({ type: 'array', items: {} }).jsonEditor === true);
  check('a missing schema maps to an empty form, not a crash', mapInputSchema(undefined).configSchema.length === 0 && mapInputSchema(undefined).jsonEditor === false);

  check('sub-schema: valid array passes', jsonFieldError('["a","b"]', byKey.tags.schema) === null);
  check('sub-schema: wrong item type is reported with its path', /\[1\] should be string/.test(jsonFieldError('["a", 2]', byKey.tags.schema) || ''), jsonFieldError('["a", 2]', byKey.tags.schema));
  check('sub-schema: missing required nested key', /city is required/.test(jsonFieldError('{"zip":"1"}', byKey.address.schema) || ''));
  check('sub-schema: oneOf accepts either branch', jsonFieldError('3', byKey.pick.schema) === null && jsonFieldError('"x"', byKey.pick.schema) === null);
  check('sub-schema: oneOf rejects other types', /any allowed shape/.test(jsonFieldError('true', byKey.pick.schema) || ''));
  check('syntax errors come before schema errors', /Invalid JSON/.test(jsonFieldError('[1,', byKey.tags.schema) || ''));
  check('{{placeholders}} are syntax-checked only (value unknown until the run)', jsonFieldError('{{input.tags}}', byKey.tags.schema) === null);
  check('empty text is fine (optional field)', jsonFieldError('', byKey.tags.schema) === null);
  check('enum mismatch at the top level', /must be one of/.test(schemaError('silver', { enum: ['free', 'gold'] }) || ''));

  const readOnlyTool = toolToAction({ name: 'lookup_customer', title: 'Look up customer', inputSchema: schema, annotations: { readOnlyHint: true } });
  const writeTool = toolToAction({ name: 'create_ticket', inputSchema: { type: 'object', properties: { subject: { type: 'string' } } }, annotations: { destructiveHint: true } });
  check('tool → action: id is the tool name, name prefers the title', readOnlyTool.id === 'lookup_customer' && readOnlyTool.name === 'Look up customer');
  check('readOnlyHint → cacheable, no side effect', readOnlyTool.cacheable === true && actionHasSideEffect(readOnlyTool) === false);
  check('no readOnlyHint → side effect, not cacheable', writeTool.sideEffect === true && writeTool.cacheable === false && actionHasSideEffect(writeTool));
  check("server-mapped configSchema wins over the client's own mapping", toolToAction({ name: 'x', configSchema: [{ key: 'q', type: 'text' }], inputSchema: schema }).configSchema.length === 1);
  check('badges: read-only / side effect / destructive', annotationBadges({ readOnlyHint: true }).join() === 'read-only' && annotationBadges({ destructiveHint: true }).join() === 'side effect,destructive' && annotationBadges().join() === 'side effect');

  // connection form payloads
  let p = mcpPayload({ transport: 'http', url: ' https://mcp.example.com/mcp ', headerName: 'X-Key', authHeader: 's3cret' });
  check('remote: url trimmed, header name in config, value only in credentials', p.config.url === 'https://mcp.example.com/mcp' && p.config.headerName === 'X-Key' && p.credentials.authHeader === 's3cret' && !('authHeader' in p.config));
  p = mcpPayload({ transport: 'http', url: 'https://a.dev', authHeader: '' }, { config: { transport: 'http', url: 'https://a.dev' }, credentialHints: { authHeader: '••••1234' } });
  check('remote edit: blank header value is kept (omitted)', !('authHeader' in p.credentials));
  p = mcpPayload({ transport: 'stdio', allowlistId: 'agentflow-demo' }, { config: { transport: 'http', url: 'https://a.dev', headerName: 'X' }, credentialHints: { authHeader: '••••' } });
  check('switching to local clears the remote fields and the stored secret', p.config.allowlistId === 'agentflow-demo' && p.config.url === null && p.config.headerName === null && p.credentials.authHeader === null);
  check('local payload never carries a command', !('command' in p.config) && !('args' in p.config) && !('env' in p.config));
  check('form: remote needs an http(s) URL', mcpFormError({ transport: 'http', url: '' }) && mcpFormError({ transport: 'http', url: 'ftp://x' }) && mcpFormError({ transport: 'http', url: 'https://x' }) === null);
  check('form: local needs an allowlist pick', mcpFormError({ transport: 'stdio' }) && mcpFormError({ transport: 'stdio', allowlistId: 'a' }) === null);

  // validation
  const n = (id, type, config) => ({ id, type, position: { x: 0, y: 0 }, data: { config } });
  const e = (source, target) => ({ id: `${source}-${target}`, source, target });
  const catalog = [
    { id: 'mcp', name: 'MCP', auth: { type: 'custom', fields: [] }, dynamicActions: true, actions: [] },
    { id: 'slack', name: 'Slack', auth: { type: 'webhookUrl', fields: [] }, actions: [{ id: 'post_message', name: 'Post message', sideEffect: true, configSchema: [] }] },
    { id: 'builtin', name: 'Built-in', auth: { type: 'none', fields: [] }, actions: [{ id: 'fake-search', name: 'Search', sideEffect: false, configSchema: [] }] },
  ];
  const connections = [{ id: 'c1', integration: 'mcp', name: 'Demo tools', mode: 'live', status: 'ok',
    config: { transport: 'stdio', allowlistId: 'agentflow-demo', toolsSnapshot: { tools: [
      { name: 'lookup_customer', annotations: { readOnlyHint: true } },
      { name: 'create_ticket', annotations: {} },
    ] } } }];
  const graph = (mid) => ({ nodes: [n('s', 'start', {}), mid, n('end', 'end', {})], edges: [e('s', mid.id), e(mid.id, 'end')], integrations: catalog, connections });
  const has = (v, prefix) => [...v.errors, ...v.warnings].some((x) => x.id.startsWith(prefix));
  const isError = (v, prefix) => v.errors.some((x) => x.id.startsWith(prefix));

  let v = validateGraph(graph(n('m', 'tool', { integration: 'mcp', action: 'lookup_customer', connectionId: null, params: {} })));
  check('MCP node without a connection is an error', isError(v, 'mcp-noconn'));
  v = validateGraph(graph(n('m', 'tool', { integration: 'mcp', action: 'lookup_customer', connectionId: 'sandbox', params: {} })));
  check("MCP node on the virtual 'sandbox' connection is an error (no server to discover)", isError(v, 'mcp-noconn'));
  v = validateGraph(graph(n('m', 'tool', { integration: 'mcp', action: 'lookup_customer', connectionId: 'gone', params: {} })));
  check('MCP node on a deleted connection is an error', isError(v, 'mcp-conn-missing'));
  v = validateGraph(graph(n('m', 'tool', { integration: 'mcp', action: 'retired_tool', connectionId: 'c1', params: {} })));
  check('tool missing from the snapshot warns "no longer offered by <server>"', v.warnings.some((w) => w.id.startsWith('mcp-tool-gone') && w.message.includes('Demo tools')));
  v = validateGraph(graph(n('m', 'tool', { integration: 'mcp', action: 'lookup_customer', connectionId: 'c1', params: {} })));
  check('a valid MCP node is clean', !has(v, 'mcp-') && !has(v, 'tool-'));

  const agent = (config) => n('a', 'agent', { label: 'Helper', ...config });
  v = validateGraph(graph(agent({ tools: [{ integration: 'mcp', action: 'lookup_customer', connectionId: 'c1' }, { integration: 'builtin', action: 'fake-search', connectionId: null }] })));
  check('agent with read-only tools only is clean', !has(v, 'agent-'));
  v = validateGraph(graph(agent({ tools: [{ integration: 'mcp', action: 'create_ticket', connectionId: 'c1' }] })));
  check('side-effecting MCP tool without the opt-in is an error', isError(v, 'agent-side-effects'));
  v = validateGraph(graph(agent({ tools: [{ integration: 'slack', action: 'post_message', connectionId: null }] })));
  check('side-effecting integration action without the opt-in is an error', isError(v, 'agent-side-effects'));
  v = validateGraph(graph(agent({ allowSideEffects: true, tools: [{ integration: 'slack', action: 'post_message', connectionId: null }, { integration: 'mcp', action: 'create_ticket', connectionId: 'c1' }] })));
  check('allowSideEffects clears that error', !has(v, 'agent-side-effects'));
  v = validateGraph(graph(agent({ tools: [{ integration: 'mcp', action: 'lookup_customer', connectionId: 'deleted' }] })));
  check('agent tool on a missing connection is a warning, not an error', v.warnings.some((w) => w.id.startsWith('agent-tool-conn')) && !isError(v, 'agent-tool-conn'));
  v = validateGraph(graph(agent({ tools: [{ integration: 'mcp', action: 'retired', connectionId: 'c1' }] })));
  check('agent tool no longer offered warns', v.warnings.some((w) => w.id.startsWith('agent-tool-gone')));
  v = validateGraph(graph(agent({ tools: Array.from({ length: 21 }, (_, i) => ({ integration: 'builtin', action: 'fake-search', connectionId: `x${i}` })) })));
  check('more than 20 agent tools is an error', isError(v, 'agent-tools-max'));
  v = validateGraph({ ...graph(agent({ tools: [{ integration: 'mcp', action: 'retired', connectionId: 'c1' }] })), connections: null });
  check('connections not loaded yet → no missing/gone warnings (nothing guessed)', !has(v, 'agent-tool'));
}

// spec/30 §3: the same fixture set the server's publish validator runs in
// check:versions, so the two copies can't drift apart unnoticed.
console.log('\nShared validation fixtures (client copy; the server copy runs them in check:versions)');
{
  const { readFileSync } = await import('node:fs');
  const fixturesUrl = new URL('../../server/src/engine/validationFixtures.json', import.meta.url);
  const { cases } = JSON.parse(readFileSync(fixturesUrl, 'utf8'));
  const ids = (list) => list.map((x) => x.id).sort();
  for (const c of cases) {
    const r = validateGraph(c.input);
    const got = { errors: ids(r.errors), warnings: ids(r.warnings), info: ids(r.info) };
    const ok = ['errors', 'warnings', 'info'].every((k) => JSON.stringify(got[k]) === JSON.stringify([...c.expect[k]].sort()));
    check(`fixture: ${c.name}`, ok, ok ? '' : JSON.stringify(got));
  }
}

// spec/32: approval nodes route by two handles.
console.log('\nApproval validation (spec/32)');
{
  const n = (id, type, config = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { config: { label: id, ...config } } });
  const base = [n('s', 'start'), n('a', 'approval', { minApprovals: 1 }), n('y', 'end'), n('x', 'end')];
  const wired = [
    { id: 'e1', source: 's', target: 'a' },
    { id: 'e2', source: 'a', target: 'y', sourceHandle: 'approved' },
    { id: 'e3', source: 'a', target: 'x', sourceHandle: 'rejected' },
  ];
  const ok = validateGraph({ nodes: base, edges: wired });
  check('both branches wired → no approval warnings', !ok.warnings.some((w) => w.id.startsWith('approval-')));
  const half = validateGraph({ nodes: base, edges: wired.filter((e) => e.sourceHandle !== 'rejected') });
  check('unwired rejected branch → warning', half.warnings.some((w) => w.id === 'approval-rejected:a'));
  const tooMany = validateGraph({
    nodes: [base[0], n('a', 'approval', { minApprovals: 3, assignees: { userIds: ['u1', 'u2'], roles: [] } }), base[2], base[3]],
    edges: wired,
  });
  check('minApprovals over the assigned people → warning', tooMany.warnings.some((w) => w.id === 'approval-min-size:a'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
