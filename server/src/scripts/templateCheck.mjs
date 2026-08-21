/**
 * Template check for spec/15. Needs a running server:
 *
 *   BASE=http://localhost:4600/api npm run check:templates
 *
 * Registers two users so the ownership boundary can actually be tested.
 */
const B = process.env.BASE || 'http://localhost:4600/api';
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

const register = async () => (await req('POST', '/auth/register', { email: `tp${Date.now()}${Math.floor(Math.random()*1e6)}@e.com`, password: 'password123' })).body.token;
const alice = await register();
const bob = await register();

const N = (id, type, config) => ({ id, type, position: { x: 0, y: 0 }, data: { config } });

console.log('built-in templates');
let r = await req('GET', '/templates', undefined, alice);
const builtIns = (r.body || []).filter((t) => t.builtIn);
check(`Alice sees ${builtIns.length} built-in template(s)`, builtIns.length >= 3, builtIns.map((t) => t.name).join(', '));
r = await req('GET', '/templates', undefined, bob);
check('Bob sees the same built-ins without creating anything', (r.body || []).filter((t) => t.builtIn).length === builtIns.length);
check('built-ins carry a graph', builtIns.every((t) => t.nodeCount > 0 && t.edgeCount > 0));

console.log('\nsave a workflow as a template');
r = await req('POST', '/workflows', { name: 'Source workflow' }, alice);
const srcId = r.body._id;
const ORIGINAL_NODES = [
  N('s', 'start', { label: 'Start' }),
  N('a', 'agent', { label: 'Router', isHandoff: true, candidates: ['x', 'y'] }),
  N('t', 'tool', { label: 'Calc', toolType: 'calculator', toolConfig: { expression: '2+2' } }),
  N('e', 'end', { label: 'End' }),
];
const ORIGINAL_EDGES = [
  { id: 'e1', source: 's', target: 'a' },
  { id: 'e2', source: 'a', target: 't', label: 'x' },
  { id: 'e3', source: 't', target: 'e' },
];
await req('PUT', `/workflows/${srcId}`, { nodes: ORIGINAL_NODES, edges: ORIGINAL_EDGES }, alice);

r = await req('POST', '/templates', { workflowId: srcId, name: 'My Template', description: 'From a workflow' }, alice);
check('template created 201', r.status === 201 && r.body.name === 'My Template', `${r.status} ${JSON.stringify(r.body?.name)}`);
const tplId = r.body._id;
check('marked as mine, not built-in', r.body.mine === true && r.body.builtIn === false);
check('captured the graph', r.body.nodeCount === 4 && r.body.edgeCount === 3, `${r.body.nodeCount}/${r.body.edgeCount}`);

console.log('\nsnapshot is decoupled from the source workflow');
await req('PUT', `/workflows/${srcId}`, { nodes: [N('s', 'start', { label: 'Gutted' })], edges: [] }, alice);
r = await req('GET', '/templates', undefined, alice);
const tpl = r.body.find((t) => t._id === tplId);
check('gutting the source left the template intact', tpl.nodeCount === 4 && tpl.edgeCount === 3, `${tpl.nodeCount}/${tpl.edgeCount}`);

console.log('\nuse the template');
r = await req('POST', `/templates/${tplId}/use`, { workflowName: 'Cloned' }, alice);
check('clone created 201', r.status === 201 && r.body.name === 'Cloned', `${r.status} ${r.body?.name}`);
const cloneId = r.body._id;
check('clone has the template graph', r.body.nodes.length === 4 && r.body.edges.length === 3);
check('clone is a different workflow', cloneId !== srcId);
check('clone preserved handoff candidates', JSON.stringify(r.body.nodes.find((n) => n.id === 'a').data.config.candidates) === '["x","y"]',
      JSON.stringify(r.body.nodes.find((n) => n.id === 'a').data.config.candidates));
check('clone preserved tool config', r.body.nodes.find((n) => n.id === 't').data.config.toolConfig.expression === '2+2');
check('clone preserved edge labels', r.body.edges.find((e) => e.id === 'e2').label === 'x');

console.log('\nediting the clone never touches the template');
await req('PUT', `/workflows/${cloneId}`, { nodes: [N('s', 'start', { label: 'Rewritten' })], edges: [] }, alice);
r = await req('GET', '/templates', undefined, alice);
check('template still intact after clone edits', r.body.find((t) => t._id === tplId).nodeCount === 4);

console.log('\ntwo clones are independent of each other');
const c1 = (await req('POST', `/templates/${tplId}/use`, {}, alice)).body;
const c2 = (await req('POST', `/templates/${tplId}/use`, {}, alice)).body;
check('different ids', c1._id !== c2._id);
check('default name derived from the template', /My Template copy/.test(c1.name), c1.name);
await req('PUT', `/workflows/${c1._id}`, { nodes: [N('s', 'start', { label: 'only c1' })], edges: [] }, alice);
r = await req('GET', `/workflows/${c2._id}`, undefined, alice);
check('editing one clone left the other alone', r.body.nodes.length === 4, String(r.body.nodes.length));

console.log('\nownership boundary');
r = await req('GET', '/templates', undefined, bob);
check("Bob cannot see Alice's template", !r.body.some((t) => t._id === tplId));
r = await req('POST', `/templates/${tplId}/use`, {}, bob);
check("Bob cannot use Alice's template (404)", r.status === 404, String(r.status));
r = await req('POST', '/templates', { workflowId: srcId, name: 'Stolen' }, bob);
check("Bob cannot template Alice's workflow (404)", r.status === 404, String(r.status));
r = await req('POST', `/templates/${builtIns[0]._id}/use`, { workflowName: 'Bob from built-in' }, bob);
check('but Bob CAN use a built-in', r.status === 201, String(r.status));

console.log('\nbad input');
r = await req('POST', '/templates', { name: 'No workflow' }, alice);
check('missing workflowId 400', r.status === 400, `${r.status} ${r.body?.error}`);
r = await req('POST', '/templates/60f000000000000000000000/use', {}, alice);
check('unknown template 404', r.status === 404, String(r.status));
r = await req('GET', '/templates');
check('unauthenticated list 401', r.status === 401, String(r.status));

console.log('\na built-in with a removed tool type still clones (spec/15 edge case)');
r = await req('POST', '/workflows', { name: 'Legacy tool' }, alice);
const legacyId = r.body._id;
await req('PUT', `/workflows/${legacyId}`, {
  nodes: [N('s', 'start', { label: 'Start' }), N('t', 'tool', { label: 'Gone', toolType: 'retired-tool', toolConfig: { keep: 'me' } })],
  edges: [{ id: 'e1', source: 's', target: 't' }],
}, alice);
r = await req('POST', '/templates', { workflowId: legacyId, name: 'Legacy template' }, alice);
const legacyTpl = r.body._id;
r = await req('POST', `/templates/${legacyTpl}/use`, {}, alice);
check('clones without crashing', r.status === 201, String(r.status));
check('unknown tool type preserved, not wiped', r.body.nodes.find((n) => n.id === 't').data.config.toolType === 'retired-tool');
check('its config preserved too', r.body.nodes.find((n) => n.id === 't').data.config.toolConfig.keep === 'me');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
