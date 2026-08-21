/**
 * Trigger check for spec/12, 13 and 21 - the acceptance criteria as a runnable
 * script. Needs a server already running; point BASE at it:
 *
 *   PORT=4500 MONGODB_URI=...-triggercheck npm run dev        # terminal 1
 *   BASE=http://localhost:4500/api npm run check:triggers     # terminal 2
 *
 * Registers a fresh user per run. Event names are timestamped because event
 * dispatch is global by design (see spec/21), so a fixed name would also fire
 * subscribers left behind by earlier runs.
 */
const B = process.env.BASE || 'http://localhost:4500/api';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`); ok ? pass++ : fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, path, body, token, raw) {
  const headers = {};
  // Set it for `raw` too - without a JSON content-type express.json() skips
  // parsing entirely, so a malformed body would never be rejected.
  if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(B + path, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, body: json, text };
}

const auth = await req('POST', '/auth/register', { email: `tr${Date.now()}@e.com`, password: 'password123' });
const tok = auth.body.token;

const NODES = [
  { id: 's', type: 'start', position: { x: 0, y: 0 }, data: { config: { label: 'Start' } } },
  { id: 't', type: 'tool', position: { x: 0, y: 0 }, data: { config: { label: 'T', toolType: 'calculator', mockOverrides: { failureRate: 0, latencyMs: [5, 15] } } } },
  { id: 'e', type: 'end', position: { x: 0, y: 0 }, data: { config: { label: 'End' } } },
];
const EDGES = [{ id: 'e1', source: 's', target: 't' }, { id: 'e2', source: 't', target: 'e' }];

async function makeWorkflow(name) {
  const { body } = await req('POST', '/workflows', { name }, tok);
  await req('PUT', `/workflows/${body._id}`, { nodes: NODES, edges: EDGES }, tok);
  return body._id;
}
const runsOf = async (id) => (await req('GET', `/workflows/${id}/runs`, undefined, tok)).body;
async function settle(id, expected = 1, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const rs = await runsOf(id);
    if (rs.length >= expected && rs.every((r) => ['success', 'failed', 'cancelled'].includes(r.status))) return rs;
    await sleep(250);
  }
  return runsOf(id);
}

console.log('SCHEDULED TRIGGERS (spec/12)');
{
  const wf = await makeWorkflow('scheduled');
  let r = await req('PUT', `/workflows/${wf}/schedule`, { cronExpression: 'not a cron', enabled: true }, tok);
  check('invalid cron rejected 400', r.status === 400, `${r.status} ${r.body?.error || ''}`);

  r = await req('PUT', `/workflows/${wf}/schedule`, { cronExpression: '*/2 * * * * *', enabled: true }, tok);
  check('valid cron accepted', r.status === 200 && r.body.enabled === true, JSON.stringify(r.body));

  await sleep(5000);
  let rs = await runsOf(wf);
  check(`cron produced run(s) automatically (${rs.length})`, rs.length >= 1);
  check('run is tagged trigger=schedule', rs[0]?.trigger === 'schedule', String(rs[0]?.trigger));

  r = await req('DELETE', `/workflows/${wf}/schedule`, undefined, tok);
  check('schedule deleted 204', r.status === 204);
  await settle(wf, 1);
  const before = (await runsOf(wf)).length;
  await sleep(5000);
  const after = (await runsOf(wf)).length;
  check(`disabling stops new runs (${before} -> ${after})`, after === before);

  // leave one enabled for the restart test
  await req('PUT', `/workflows/${wf}/schedule`, { cronExpression: '0 3 * * *', enabled: true }, tok);
  console.log(`  (left workflow ${wf} scheduled for the restart check)`);
}

console.log('\nWEBHOOK TRIGGER (spec/13)');
{
  const wf = await makeWorkflow('webhooked');
  let r = await req('POST', `/workflows/${wf}/webhook/regenerate`, undefined, tok);
  const token1 = r.body.token;
  check('regenerate returns token + url', Boolean(token1 && r.body.url?.includes(token1)), r.body.url);

  r = await req('POST', `/hooks/${token1}`, { city: 'Lisbon', expression: '6*7' });
  check('POST /api/hooks/:token accepted 202', r.status === 202 && Boolean(r.body.runId), `${r.status} ${JSON.stringify(r.body)}`);
  const runId = r.body.runId;

  await settle(wf, 1);
  const run = (await req('GET', `/runs/${runId}`, undefined, tok)).body;
  check('run tagged trigger=webhook', run.trigger === 'webhook', String(run.trigger));
  const startNode = run.nodeResults.find((x) => x.nodeId === 's');
  check('payload reached the Start node as its output', startNode?.output?.city === 'Lisbon', JSON.stringify(startNode?.output));
  const toolNode = run.nodeResults.find((x) => x.nodeId === 't');
  check('payload flowed into the tool (6*7=42)', toolNode?.output?.result === 42, JSON.stringify(toolNode?.output));

  r = await req('POST', `/hooks/${token1}`);
  check('no-payload call still works', r.status === 202, String(r.status));
  await settle(wf, 2);

  r = await req('POST', `/workflows/${wf}/webhook/regenerate`, undefined, tok);
  const token2 = r.body.token;
  check('regenerated token differs', token2 !== token1);
  r = await req('POST', `/hooks/${token1}`);
  check('old token now 404', r.status === 404, String(r.status));
  r = await req('POST', `/hooks/${token2}`);
  check('new token works 202', r.status === 202, String(r.status));
  await settle(wf, 3);

  r = await req('PUT', `/workflows/${wf}/webhook`, { enabled: false }, tok);
  check('disable returns 200', r.status === 200 && r.body.enabled === false, JSON.stringify(r.body));
  r = await req('POST', `/hooks/${token2}`);
  check('disabled webhook 404s', r.status === 404, String(r.status));

  r = await req('POST', `/hooks/${'0'.repeat(48)}`);
  check('unknown token 404s (same as disabled)', r.status === 404, String(r.status));

  await req('PUT', `/workflows/${wf}/webhook`, { enabled: true }, tok);
  r = await req('POST', `/hooks/${token2}`, undefined, undefined, '{ this is not json');
  check('malformed JSON body 400 with a clear message', r.status === 400 && /malformed/i.test(r.body?.error || ''), `${r.status} ${r.body?.error}`);
}

console.log('\nEXTERNAL EVENT TRIGGER (spec/21)');
{
  // Unique per run: event names are global (any caller, any owner), so a fixed
  // name would also fire subscribers left behind by earlier runs.
  const EVENT = `order.created.${Date.now()}`;
  const a = await makeWorkflow('subscriber A');
  const b = await makeWorkflow('subscriber B');
  const c = await makeWorkflow('not subscribed');

  let r = await req('PUT', `/workflows/${a}/event-trigger`, { eventName: EVENT, enabled: true }, tok);
  check('subscribe A', r.status === 200 && r.body.eventName === EVENT, JSON.stringify(r.body));
  await req('PUT', `/workflows/${b}/event-trigger`, { eventName: EVENT, enabled: true }, tok);
  await req('PUT', `/workflows/${c}/event-trigger`, { eventName: 'other.thing', enabled: true }, tok);

  r = await req('PUT', `/workflows/${a}/event-trigger`, { eventName: '', enabled: true }, tok);
  check('enabling without a name rejected 400', r.status === 400, `${r.status} ${r.body?.error}`);
  await req('PUT', `/workflows/${a}/event-trigger`, { eventName: EVENT, enabled: true }, tok);

  r = await req('POST', `/events/${EVENT}`, { orderId: 99 });
  check(`one event started 2 runs (${r.body?.triggered?.length})`, r.status === 202 && r.body.triggered.length === 2, JSON.stringify(r.body));

  await settle(a, 1); await settle(b, 1);
  const ra = (await runsOf(a))[0], rb = (await runsOf(b))[0];
  check('both subscribers ran with trigger=event', ra?.trigger === 'event' && rb?.trigger === 'event', `${ra?.trigger}/${rb?.trigger}`);
  check('the unsubscribed workflow did not run', (await runsOf(c)).length === 0);

  const runA = (await req('GET', `/runs/${(await runsOf(a))[0].id}`, undefined, tok)).body;
  const startOut = runA?.nodeResults?.find((x) => x.nodeId === 's')?.output;
  check('event payload reached the Start node', startOut?.orderId === 99, JSON.stringify(startOut));

  r = await req('POST', '/events/nobody.listens.' + Date.now(), { x: 1 });
  check('no subscribers -> 202 with empty list, not 404', r.status === 202 && r.body.triggered.length === 0, `${r.status} ${JSON.stringify(r.body)}`);

  // a workflow mid-run is skipped, others still fire
  await req('PUT', `/workflows/${c}/event-trigger`, { eventName: EVENT, enabled: true }, tok);
  const slowNodes = JSON.parse(JSON.stringify(NODES));
  slowNodes[1].data.config.mockOverrides.latencyMs = [1500, 1600];
  await req('PUT', `/workflows/${a}`, { nodes: slowNodes, edges: EDGES }, tok);
  // Unique payloads per dispatch: an identical tool input would be served from
  // the TTL cache and finish instantly, so nothing would still be running.
  await req('POST', `/events/${EVENT}`, { expression: `1+${Date.now()}` });   // starts A (slow), B, C
  await sleep(400);
  r = await req('POST', `/events/${EVENT}`, { expression: `2+${Date.now()}` }); // A still running
  check(`second dispatch skipped the busy workflow (triggered ${r.body.triggered.length}, skipped ${r.body.skipped.length})`,
        r.body.skipped.some((s) => s.reason === 'already-running'), JSON.stringify(r.body.skipped));
  check('but still started the idle ones', r.body.triggered.length >= 1, JSON.stringify(r.body.triggered));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
