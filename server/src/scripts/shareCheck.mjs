/**
 * Share-link check for spec/18. Needs a running server:
 *
 *   BASE=http://localhost:4800/api npm run check:share
 *
 * The emphasis is on what a link-holder must NOT get: a read-only viewer who
 * receives the webhook token could start runs, which would turn a view link into
 * an execute link.
 */
const B = process.env.BASE || 'http://localhost:4800/api';
let pass = 0, fail = 0;
const WS = new Map(); // token -> workspaceId
const check = (n, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`); ok ? pass++ : fail++; };

async function req(method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  // spec/22: tenant routes need the caller's workspace. Each token maps to the
  // personal workspace it was registered with.
  if (token && WS.has(token)) headers['X-Workspace-Id'] = WS.get(token);
  const res = await fetch(B + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, body: json };
}

const register = async (tag) => {
  const { body } = await req('POST', '/auth/register', { email: `${tag}${Date.now()}@e.com`, password: 'password123' });
  WS.set(body.token, body.workspaces[0].id);
  return body.token;
};
const alice = await register('al');
const bob = await register('bo');

const N = (id, type, config) => ({ id, type, position: { x: 0, y: 0 }, data: { config } });
let r = await req('POST', '/workflows', { name: 'Shared design' }, alice);
const wfId = r.body._id;
await req('PUT', `/workflows/${wfId}`, {
  nodes: [N('s', 'start', { label: 'Start' }), N('t', 'tool', { label: 'Calc', toolType: 'calculator', toolConfig: { expression: '2+2' } }), N('e', 'end', { label: 'End' })],
  edges: [{ id: 'e1', source: 's', target: 't' }, { id: 'e2', source: 't', target: 'e' }],
}, alice);
// spec/30: a share link shows the PUBLISHED version, so publish the design.
await req('POST', `/workflows/${wfId}/publish`, { acknowledgeWarnings: true }, alice);

// Give it a webhook, a schedule and an event subscription — all things the share
// payload must withhold.
const hook = (await req('POST', `/workflows/${wfId}/webhook/regenerate`, undefined, alice)).body;
await req('PUT', `/workflows/${wfId}/schedule`, { cronExpression: '0 4 * * *', enabled: true }, alice);
await req('PUT', `/workflows/${wfId}/event-trigger`, { eventName: `share.evt.${Date.now()}`, enabled: true }, alice);
await req('POST', `/workflows/${wfId}/runs`, undefined, alice);
await new Promise((res) => setTimeout(res, 2500));

console.log('creating a link');
r = await req('POST', `/workflows/${wfId}/share`, undefined, alice);
check('returns a token and url', Boolean(r.body.shareToken) && r.body.url.includes(r.body.shareToken), r.body.url);
const token1 = r.body.shareToken;
check('url points at the /shared page, not the API', /\/shared\//.test(r.body.url) && !/\/api\/shared\//.test(r.body.url), r.body.url);

console.log('\nfetching it needs no auth');
r = await req('GET', `/shared/${token1}`);
check('HTTP 200 with no Authorization header', r.status === 200, String(r.status));
const shared = r.body;
check('includes the graph', shared.workflow.nodes.length === 3 && shared.workflow.edges.length === 2);
check('includes the name', shared.workflow.name === 'Shared design');
check('marked readOnly', shared.workflow.readOnly === true);
check('includes recent runs', Array.isArray(shared.runs) && shared.runs.length >= 1, `${shared.runs?.length} runs`);
check('runs carry status + trigger', Boolean(shared.runs[0]?.status) && Boolean(shared.runs[0]?.trigger), JSON.stringify(shared.runs[0]));

console.log('\nwhat the payload must NOT contain');
const flat = JSON.stringify(shared);
check('no webhook token (would let a viewer START runs)', !flat.includes(hook.token));
check('no webhook object at all', shared.workflow.webhook === undefined);
check('no schedule', shared.workflow.schedule === undefined);
check('no event subscription', shared.workflow.eventTrigger === undefined);
check('no ownerId', shared.workflow.ownerId === undefined && !/ownerId/.test(flat));
check('no createdBy or workspaceId (spec/22)', !/createdBy|workspaceId/.test(flat));
check('does not echo the shareToken', !flat.includes(token1));
check('no per-node run outputs', !/nodeResults/.test(flat));

console.log('\nthe link really is read-only');
r = await req('PUT', `/workflows/${wfId}`, { name: 'Hacked' }, undefined);
check('cannot edit the workflow unauthenticated (401)', r.status === 401, String(r.status));
r = await req('POST', `/workflows/${wfId}/runs`, undefined, undefined);
check('cannot start a run unauthenticated (401)', r.status === 401, String(r.status));
r = await req('POST', `/shared/${token1}`, {});
check('the shared endpoint is GET-only (404/405)', [404, 405].includes(r.status), String(r.status));

console.log('\nregenerating invalidates the old link');
r = await req('POST', `/workflows/${wfId}/share`, undefined, alice);
const token2 = r.body.shareToken;
check('new token differs', token2 !== token1);
r = await req('GET', `/shared/${token1}`);
check('old token now 404', r.status === 404, String(r.status));
r = await req('GET', `/shared/${token2}`);
check('new token works', r.status === 200, String(r.status));

console.log('\ndisabling sharing');
r = await req('DELETE', `/workflows/${wfId}/share`, undefined, alice);
check('DELETE returns 204', r.status === 204, String(r.status));
r = await req('GET', `/shared/${token2}`);
check('link stops working immediately (404)', r.status === 404, String(r.status));
r = await req('GET', `/shared/${'0'.repeat(48)}`);
check('unknown token 404s identically', r.status === 404, String(r.status));

console.log('\nownership boundary');
r = await req('POST', `/workflows/${wfId}/share`, undefined, bob);
check("Bob cannot share Alice's workflow (404)", r.status === 404, String(r.status));
r = await req('DELETE', `/workflows/${wfId}/share`, undefined, bob);
check("Bob cannot revoke Alice's sharing (404)", r.status === 404, String(r.status));
r = await req('GET', `/shared/${token2}`, undefined, bob);
check('a revoked link stays dead even for a logged-in user', r.status === 404, String(r.status));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
