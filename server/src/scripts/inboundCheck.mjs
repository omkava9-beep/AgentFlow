/**
 * Inbound check for spec/27 part 2 - inbound provider webhooks, "Send test
 * event", the RSS poll trigger, the Knowledge Base and the AI presets.
 *
 *   PORT=4500 MONGODB_URI=...-check INTEGRATIONS_LIVE=false npm run dev      # terminal 1
 *   BASE=http://localhost:4500/api MONGODB_URI=... npm run check:inbound     # terminal 2
 *
 * Sections A-F run against BASE. Section G (RSS) needs real outbound fetches,
 * so it starts its own server with INTEGRATIONS_LIVE=true and private networks
 * allowed (to reach a local feed server), then kills it and drops its database.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(HERE, '../..');
const B = process.env.BASE || 'http://localhost:4500/api';
const DB_URI = process.env.MONGODB_URI;
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`); ok ? pass++ : fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const brief = (v, n = 240) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? `${s.slice(0, n)}…` : s; };
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

if (!DB_URI) {
  console.error("MONGODB_URI must be set to the running server's database");
  process.exit(1);
}

// ------------------------------------------------------------------ HTTP helpers
function client(base) {
  return async function req(method, p, { body, token, ws, headers: extra = {}, raw } = {}) {
    const headers = { ...extra };
    if (body !== undefined && raw === undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    if (ws) headers['X-Workspace-Id'] = String(ws);
    const res = await fetch(base + p, { method, headers, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    return { status: res.status, body: json, text };
  };
}
const req = client(B);
const origin = (base) => base.replace(/\/api\/?$/, '');

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
async function register(r, tag, email = `${tag}${uniq()}@inbound.dev`) {
  const res = await r('POST', '/auth/register', { body: { email, password: 'password123', name: tag } });
  const ws = res.body?.workspaces?.[0];
  return { token: res.body?.token, user: res.body?.user, email, ws: ws?.id, slug: ws?.slug };
}
async function join(r, owner, role) {
  const email = `${role}${uniq()}@inbound.dev`;
  const inv = await r('POST', `/workspaces/${owner.ws}/invitations`, { body: { email, role }, token: owner.token });
  const u = await register(r, role, email);
  await r('POST', `/invitations/${String(inv.body?.inviteUrl || '').split('/invite/').pop()}/accept`, { token: u.token });
  return { ...u, ws: owner.ws, slug: owner.slug };
}

const N = (id, type, config = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { config: { label: id, ...config } } });
const toolNode = (id, integration, action, extra = {}) =>
  N(id, 'tool', { integration, action, connectionId: null, params: {}, mockOverrides: { failureRate: 0, latencyMs: [5, 10] }, ...extra });
const chain = (...middle) => {
  const nodes = [N('s', 'start'), ...middle, N('e', 'end')];
  const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: nodes[i].id, target: n.id }));
  return { nodes, edges };
};

async function makeWorkflow(r, u, name, graph = chain()) {
  const wf = await r('POST', '/workflows', { body: { name }, token: u.token, ws: u.ws });
  const id = wf.body?._id;
  await r('PUT', `/workflows/${id}`, { body: graph, token: u.token, ws: u.ws });
  // spec/30: triggers and share links use the PUBLISHED version, so fixtures
  // are published the way a user would press Publish after building them.
  await r('POST', `/workflows/${id}/publish`, { body: { acknowledgeWarnings: true }, token: u.token, ws: u.ws });
  return id;
}
async function subscribe(r, u, wfId, eventName, connectionId = null) {
  return r('PUT', `/workflows/${wfId}/event-trigger`, { body: { eventName, enabled: true, connectionId }, token: u.token, ws: u.ws });
}
async function runsOf(r, u, wfId) {
  const res = await r('GET', `/workflows/${wfId}/runs`, { token: u.token, ws: u.ws });
  return Array.isArray(res.body) ? res.body : (res.body?.runs || []);
}
async function waitRun(r, u, runId, tries = 80) {
  for (let i = 0; i < tries; i++) {
    const res = await r('GET', `/runs/${runId}`, { token: u.token, ws: u.ws });
    if (['success', 'failed', 'cancelled'].includes(res.body?.status)) return res.body;
    await sleep(100);
  }
  return null;
}
const waitAll = (r, u, ids) => Promise.all((ids || []).map((id) => waitRun(r, u, id)));

async function makeConnection(r, u, body) {
  const res = await r('POST', '/connections', { body, token: u.token, ws: u.ws });
  const id = res.body?.id || res.body?._id;
  let inboundUrl = res.body?.inboundUrl;
  if (id && !inboundUrl) inboundUrl = (await r('GET', `/connections/${id}`, { token: u.token, ws: u.ws })).body?.inboundUrl;
  // The URL is built from PUBLIC_BASE_URL, which may not be this test server:
  // keep the path, call it on BASE.
  const hookPath = inboundUrl ? new URL(inboundUrl).pathname.replace(/^\/api/, '') : null;
  return { id, status: res.status, body: res.body, hookPath };
}

await mongoose.connect(DB_URI);

const owner = await register(req, 'inowner');
const viewer = await join(req, owner, 'viewer');
const other = await register(req, 'inother');

// ====================================================================== A. inbound webhooks
console.log('A. signed provider webhooks → per-workspace integration events');
const GH_SECRET = `ghsec_${uniq()}`;
const ST_SECRET = `whsec_${uniq()}`;
const gh = await makeConnection(req, owner, { integration: 'github', name: 'GitHub main', mode: 'sandbox', credentials: { token: `ghp_${uniq()}`, webhookSecret: GH_SECRET } });
const stA = await makeConnection(req, owner, { integration: 'stripe', name: 'Stripe EU', mode: 'sandbox', credentials: { secretKey: `sk_test_${uniq()}`, webhookSecret: ST_SECRET } });
const stB = await makeConnection(req, owner, { integration: 'stripe', name: 'Stripe US', mode: 'sandbox', credentials: { secretKey: `sk_test_${uniq()}` } });
const sl = await makeConnection(req, owner, { integration: 'slack', name: 'Slack events', mode: 'sandbox', credentials: { webhookUrl: 'https://hooks.slack.com/services/T000/B000/XXXX' } });
check('GitHub, 2× Stripe and Slack connections created with inbound URLs',
  [gh, stA, stB, sl].every((c) => c.status === 201 && c.hookPath?.startsWith(`/w/${owner.slug}/hooks/`)),
  [gh, stA, stB, sl].map((c) => `${c.status}:${c.hookPath ? 'url' : brief(c.body, 80)}`).join(' '));

const wfGh = await makeWorkflow(req, owner, 'on issue opened');
const wfStA = await makeWorkflow(req, owner, 'on EU payment failed');
const wfStB = await makeWorkflow(req, owner, 'on US payment failed');
const wfStAny = await makeWorkflow(req, owner, 'on any payment failed');
const wfSlack = await makeWorkflow(req, owner, 'on slack message');
const subs = await Promise.all([
  subscribe(req, owner, wfGh, 'github.issue_opened'),
  subscribe(req, owner, wfStA, 'stripe.payment_failed', stA.id),
  subscribe(req, owner, wfStB, 'stripe.payment_failed', stB.id),
  subscribe(req, owner, wfStAny, 'stripe.payment_failed'),
  subscribe(req, owner, wfSlack, 'slack.message_received'),
]);
check('event subscriptions saved (two with a connection filter)', subs.every((s) => s.status === 200) && String(subs[1].body?.connectionId) === String(stA.id),
  subs.map((s) => s.status).join(','));

// Another workspace listening to the same event name must not hear this one's deliveries.
const otherWf = await makeWorkflow(req, other, 'other tenant, same event');
await subscribe(req, other, otherWf, 'github.issue_opened');

const ghBody = JSON.stringify({ action: 'opened', issue: { number: 42, title: 'Checkout broken on Safari', html_url: 'https://github.com/acme/web/issues/42', user: { login: 'mira' } }, repository: { full_name: 'acme/web' } });
const ghHeaders = (body, secret = GH_SECRET, event = 'issues') => ({
  'Content-Type': 'application/json', 'X-GitHub-Event': event, 'X-GitHub-Delivery': `d-${uniq()}`,
  'X-Hub-Signature-256': `sha256=${hmac(secret, body)}`,
});
{
  const res = await req('POST', gh.hookPath, { raw: ghBody, headers: ghHeaders(ghBody) });
  check('signed GitHub issues/opened → 202 with one run', res.status === 202 && res.body?.triggered?.length === 1, `${res.status} ${brief(res.body)}`);
  const run = res.body?.triggered?.[0] && await waitRun(req, owner, res.body.triggered[0]);
  const input = run?.input || {};
  check('run belongs to the subscribed workflow and succeeded', String(run?.workflowId) === String(wfGh) && run?.status === 'success', `${run?.workflowId} ${run?.status}`);
  check('Start input is spec/26\'s envelope (event, integration, connectionId, test:false, receivedAt, data)',
    input.event === 'github.issue_opened' && input.integration === 'github' && String(input.connectionId) === String(gh.id) && input.test === false && input.receivedAt && input.data,
    brief(input));
  check('run trigger is "event"', run?.trigger === 'event', run?.trigger);
  check('the other workspace\'s same-named subscription did not fire', (await runsOf(req, other, otherWf)).length === 0);

  const bad = await req('POST', gh.hookPath, { raw: ghBody, headers: ghHeaders(ghBody, 'wrong-secret') });
  check('bad GitHub signature → 401', bad.status === 401, `${bad.status} ${brief(bad.body)}`);
  const unsigned = await req('POST', gh.hookPath, { raw: ghBody, headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'issues' } });
  check('missing signature when a secret is set → 401', unsigned.status === 401, `${unsigned.status}`);
  const tampered = await req('POST', gh.hookPath, { raw: ghBody.replace('Safari', 'Firefox'), headers: ghHeaders(ghBody) });
  check('body changed after signing → 401', tampered.status === 401, `${tampered.status}`);

  const star = JSON.stringify({ action: 'created' });
  const ignored = await req('POST', gh.hookPath, { raw: star, headers: ghHeaders(star, GH_SECRET, 'star') });
  check('unmapped GitHub event → 202 ignored, no run', ignored.status === 202 && ignored.body?.ignored === true && ignored.body?.triggered?.length === 0, `${ignored.status} ${brief(ignored.body)}`);

  const token = gh.hookPath.split('/').pop();
  const wrongToken = await req('POST', gh.hookPath.replace(token, 'x'.repeat(48)), { raw: ghBody, headers: ghHeaders(ghBody) });
  check('wrong inbound token → 404', wrongToken.status === 404, `${wrongToken.status}`);
  const wrongSlug = await req('POST', gh.hookPath.replace(`/w/${owner.slug}/`, `/w/${other.slug}/`), { raw: ghBody, headers: ghHeaders(ghBody) });
  check('right token under another workspace\'s slug → 404', wrongSlug.status === 404, `${wrongSlug.status}`);
  const wrongIntegration = await req('POST', gh.hookPath.replace('/hooks/github/', '/hooks/stripe/'), { raw: ghBody, headers: ghHeaders(ghBody) });
  check('right token under another integration → 404', wrongIntegration.status === 404, `${wrongIntegration.status}`);
}

const stripeEvent = (type) => JSON.stringify({ id: `evt_${uniq()}`, type, data: { object: { id: `pi_${uniq()}`, amount: 12900, currency: 'usd', customer: 'cus_1', status: 'requires_payment_method', last_payment_error: { message: 'Your card was declined.' } } } });
const stripeSig = (body, secret = ST_SECRET, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${hmac(secret, `${t}.${body}`)}`;
{
  const before = { A: (await runsOf(req, owner, wfStA)).length, B: (await runsOf(req, owner, wfStB)).length, any: (await runsOf(req, owner, wfStAny)).length };
  const body = stripeEvent('payment_intent.payment_failed');
  const res = await req('POST', stA.hookPath, { raw: body, headers: { 'Content-Type': 'application/json', 'Stripe-Signature': stripeSig(body) } });
  check('signed Stripe payment_intent.payment_failed → 202', res.status === 202, `${res.status} ${brief(res.body)}`);
  await waitAll(req, owner, res.body?.triggered);
  const after = { A: (await runsOf(req, owner, wfStA)).length, B: (await runsOf(req, owner, wfStB)).length, any: (await runsOf(req, owner, wfStAny)).length };
  check('fires the EU-filtered and the unfiltered subscriber, not the US-filtered one',
    after.A === before.A + 1 && after.any === before.any + 1 && after.B === before.B && res.body?.triggered?.length === 2,
    `before ${JSON.stringify(before)} after ${JSON.stringify(after)}`);
  const run = res.body?.triggered?.[0] && await waitRun(req, owner, res.body.triggered[0]);
  check('Stripe envelope data carries the PaymentIntent fields', run?.input?.data?.amount === 12900 && run?.input?.event === 'stripe.payment_failed', brief(run?.input));

  const bad = await req('POST', stA.hookPath, { raw: body, headers: { 'Content-Type': 'application/json', 'Stripe-Signature': stripeSig(body, 'whsec_wrong') } });
  check('bad Stripe signature → 401', bad.status === 401, `${bad.status}`);
  const stale = await req('POST', stA.hookPath, { raw: body, headers: { 'Content-Type': 'application/json', 'Stripe-Signature': stripeSig(body, ST_SECRET, Math.floor(Date.now() / 1000) - 3600) } });
  check('Stripe signature outside the 5-minute tolerance → 401', stale.status === 401, `${stale.status}`);

  // Stripe US has no signing secret: the token in the URL is the only credential.
  const bodyB = stripeEvent('payment_intent.payment_failed');
  const unsignedB = await req('POST', stB.hookPath, { raw: bodyB, headers: { 'Content-Type': 'application/json' } });
  await waitAll(req, owner, unsignedB.body?.triggered);
  check('connection without a secret accepts unsigned deliveries (fires US-filtered + unfiltered)', unsignedB.status === 202 && unsignedB.body?.triggered?.length === 2, `${unsignedB.status} ${brief(unsignedB.body)}`);
}
{
  const challenge = `ch_${uniq()}`;
  const res = await req('POST', sl.hookPath, { body: { type: 'url_verification', challenge, token: 'legacy' } });
  check('Slack url_verification challenge is echoed', res.status === 200 && res.body?.challenge === challenge, `${res.status} ${brief(res.body)}`);
  const msg = await req('POST', sl.hookPath, { body: { type: 'event_callback', event_id: `Ev${uniq()}`, event: { type: 'message', channel: 'C1', user: 'U1', text: 'Is the refund done?' } } });
  await waitAll(req, owner, msg.body?.triggered);
  check('Slack event_callback message → slack.message_received run', msg.status === 202 && msg.body?.triggered?.length === 1, `${msg.status} ${brief(msg.body)}`);
}

// ====================================================================== B. send test event
console.log('\nB. "Send test event"');
{
  const before = (await runsOf(req, owner, wfGh)).length;
  const res = await req('POST', '/integrations/github/triggers/issue_opened/test', { body: {}, token: owner.token, ws: owner.ws });
  check('test event → 202 and starts the subscriber', res.status === 202 && res.body?.triggered?.length === 1, `${res.status} ${brief(res.body)}`);
  const run = res.body?.triggered?.[0] && await waitRun(req, owner, res.body.triggered[0]);
  check('test run carries test: true and the sample payload', run?.input?.test === true && run?.input?.data && run?.input?.event === 'github.issue_opened', brief(run?.input));
  const list = await runsOf(req, owner, wfGh);
  check('run history marks the test run (TEST badge)', list.length === before + 1 && list.some((r) => r.test === true), brief(list.map((r) => r.test)));

  const alt = await req('POST', `/workspaces/${owner.ws}/integrations/github/triggers/issue_opened/test`, { body: {}, token: owner.token });
  await waitAll(req, owner, alt.body?.triggered);
  check('also served under /api/workspaces/:id/integrations', alt.status === 202, `${alt.status}`);

  const beforeB = (await runsOf(req, owner, wfStB)).length;
  const beforeA = (await runsOf(req, owner, wfStA)).length;
  const withConn = await req('POST', '/integrations/stripe/triggers/payment_failed/test', { body: { connectionId: stB.id }, token: owner.token, ws: owner.ws });
  await waitAll(req, owner, withConn.body?.triggered);
  check('test event with a connection → only that connection\'s filtered subscriber (+ unfiltered)',
    withConn.status === 202 && (await runsOf(req, owner, wfStB)).length === beforeB + 1 && (await runsOf(req, owner, wfStA)).length === beforeA,
    `${withConn.status} ${brief(withConn.body)}`);
  const noConn = await req('POST', '/integrations/stripe/triggers/payment_failed/test', { body: {}, token: owner.token, ws: owner.ws });
  await waitAll(req, owner, noConn.body?.triggered);
  check('test event without a connection skips connection-filtered subscribers', noConn.body?.triggered?.length === 1, brief(noConn.body));

  const v = await req('POST', '/integrations/github/triggers/issue_opened/test', { body: {}, token: viewer.token, ws: viewer.ws });
  check('viewer → 403', v.status === 403, `${v.status}`);
  const unknown = await req('POST', '/integrations/github/triggers/nope/test', { body: {}, token: owner.token, ws: owner.ws });
  check('unknown trigger → 404', unknown.status === 404, `${unknown.status}`);
  const foreign = await req('POST', '/integrations/stripe/triggers/payment_failed/test', { body: { connectionId: stA.id }, token: other.token, ws: other.ws });
  check('another workspace\'s connection id → 404', foreign.status === 404, `${foreign.status}`);
}

// ====================================================================== C. filters & loop safety
console.log('\nC. event-trigger connection filter validation, and sandbox writes never fire triggers');
{
  const wf = await makeWorkflow(req, owner, 'filter validation');
  const mismatch = await subscribe(req, owner, wf, 'stripe.payment_failed', sl.id);
  check('a Slack connection cannot filter a stripe.* event → 400', mismatch.status === 400, `${mismatch.status} ${brief(mismatch.body)}`);
  const otherConn = await makeConnection(req, other, { integration: 'stripe', name: 'Globex Stripe', mode: 'sandbox', credentials: { secretKey: 'sk_test_x' } });
  const foreign = await subscribe(req, owner, wf, 'stripe.payment_failed', otherConn.id);
  check('another workspace\'s connection as a filter → 400', foreign.status === 400, `${foreign.status}`);

  const before = (await runsOf(req, owner, wfGh)).length;
  const writer = await makeWorkflow(req, owner, 'sandbox issue writer', chain(toolNode('t', 'github', 'create_issue', { connectionId: 'sandbox', params: { repo: 'acme/web', title: 'Created by a sandbox run' } })));
  const run = await req('POST', `/workflows/${writer}/runs`, { token: owner.token, ws: owner.ws });
  const done = await waitRun(req, owner, run.body?.runId);
  await sleep(300);
  check('sandbox github.create_issue ran', done?.status === 'success', `${done?.status} ${brief(done?.nodeResults?.find((r) => r.nodeId === 't'))}`);
  check('…and did NOT fire the github.issue_opened subscriber', (await runsOf(req, owner, wfGh)).length === before);
}

// ====================================================================== D. knowledge base
console.log('\nD. Knowledge Base: upload, search, workspace isolation, the search action');
{
  const phrase = `zephyrquartz${uniq()}`;
  const text = `Shipping policy\n\nOrders ship within two business days.\n\nRefund policy\n\nRefunds for ${phrase} orders are issued within five business days of the return arriving.`;
  const add = await req('POST', '/knowledge', { body: { title: 'Policies', text }, token: owner.token, ws: owner.ws });
  check('owner adds a document (201, chunked)', add.status === 201 && add.body?.chunkCount >= 1, `${add.status} ${brief(add.body)}`);
  await req('POST', '/knowledge', { body: { title: 'Unrelated', text: 'The office plants are watered on Fridays.' }, token: owner.token, ws: owner.ws });

  const hit = await req('GET', `/knowledge/search?q=${encodeURIComponent(`${phrase} refund`)}`, { token: owner.token, ws: owner.ws });
  check('search returns the chunk containing the unique phrase first', hit.body?.results?.[0]?.chunk?.includes(phrase), brief(hit.body));
  const iso = await req('GET', `/knowledge/search?q=${phrase}`, { token: other.token, ws: other.ws });
  check('another workspace never sees it', iso.status === 200 && iso.body?.results?.length === 0, brief(iso.body));
  const empty = await req('GET', '/knowledge/search?q=anything', { token: other.token, ws: other.ws });
  check('empty workspace search → { results: [] }', Array.isArray(empty.body?.results) && empty.body.results.length === 0);

  const vList = await req('GET', '/knowledge', { token: viewer.token, ws: viewer.ws });
  const vAdd = await req('POST', '/knowledge', { body: { title: 'x', text: 'y' }, token: viewer.token, ws: viewer.ws });
  check('viewer can list (200) but not add (403)', vList.status === 200 && vAdd.status === 403, `${vList.status}/${vAdd.status}`);
  const big = await req('POST', '/knowledge', { body: { title: 'big', text: 'a'.repeat(210 * 1024) }, token: owner.token, ws: owner.ws });
  check('a document over 200 KB → 413', big.status === 413, `${big.status}`);

  const wf = await makeWorkflow(req, owner, 'kb search', chain(toolNode('k', 'knowledge', 'search', { params: { query: `How long do ${phrase} refunds take?`, topK: 2 } })));
  const run = await req('POST', `/workflows/${wf}/runs`, { token: owner.token, ws: owner.ws });
  const done = await waitRun(req, owner, run.body?.runId);
  const k = done?.nodeResults?.find((r) => r.nodeId === 'k');
  check('knowledge.search node returns the matching chunk', done?.status === 'success' && k?.output?.results?.[0]?.chunk?.includes(phrase), brief(k));

  const del = await req('DELETE', `/knowledge/${add.body?.id}`, { token: owner.token, ws: owner.ws });
  const after = await req('GET', `/knowledge/search?q=${phrase}`, { token: owner.token, ws: owner.ws });
  check('deleting the document removes it from search', del.status === 204 && after.body?.results?.length === 0, `${del.status} ${brief(after.body)}`);
}

// ====================================================================== E. AI presets
console.log('\nE. AI presets run through the agent provider (mock here)');
{
  const wf = await makeWorkflow(req, owner, 'ai presets', chain(
    toolNode('c', 'ai', 'classify', { params: { labels: 'refund, bug, question' }, mockOverrides: { failureRate: 0, maxAttempts: 5 } }),
  ));
  // Extract reads the webhook payload directly; a second workflow keeps each assertion simple.
  const wf2 = await makeWorkflow(req, owner, 'ai extract', chain(
    toolNode('x', 'ai', 'extract', { params: { fields: 'email, orderId' }, mockOverrides: { failureRate: 0, maxAttempts: 5 } }),
  ));
  const fire = async (id, payload) => {
    const hook = await req('POST', `/workflows/${id}/webhook/regenerate`, { token: owner.token, ws: owner.ws });
    await req('PUT', `/workflows/${id}/webhook`, { body: { enabled: true }, token: owner.token, ws: owner.ws });
    const res = await req('POST', `/hooks/${hook.body?.token}`, { body: payload });
    return waitRun(req, owner, res.body?.runId);
  };
  const r1 = await fire(wf, { text: 'Hi, I would like a REFUND for order 1042', email: 'mira@example.com' });
  const c = r1?.nodeResults?.find((n) => n.nodeId === 'c');
  check('ai.classify picks the label named in the input', c?.status === 'success' && c?.output?.label === 'refund', brief(c));
  check('node result mode is "mock" (the active agent provider)', c?.mode === 'mock', `${c?.mode}`);
  const r2 = await fire(wf2, { customer: { email: 'mira@example.com' }, orderId: 1042 });
  const x = r2?.nodeResults?.find((n) => n.nodeId === 'x');
  check('ai.extract pulls the requested fields', x?.output?.email === 'mira@example.com' && x?.output?.orderId === 1042, brief(x?.output));
}

// ====================================================================== F. catalogue shape
console.log('\nF. catalogue flags for the gallery');
{
  const cat = await req('GET', '/integrations', { token: owner.token });
  const byId = Object.fromEntries((cat.body?.integrations || []).map((i) => [i.id, i]));
  check('rss, knowledge and ai are registered', Boolean(byId.rss && byId.knowledge && byId.ai), Object.keys(byId).join(','));
  check('integrations with triggers expose hasInbound (github, stripe, slack); rss (poll-only) does not',
    byId.github?.hasInbound && byId.stripe?.hasInbound && byId.slack?.hasInbound && byId.rss?.hasInbound === false,
    ['github', 'stripe', 'slack', 'rss'].map((k) => `${k}:${byId[k]?.hasInbound}`).join(' '));
  check('rss.read_feed is live-capable; knowledge/ai are not', byId.rss?.liveCapable === true && byId.knowledge?.liveCapable === false && byId.ai?.liveCapable === false);
}

// ====================================================================== G. RSS on a live server
console.log('\nG. RSS poll trigger on a private INTEGRATIONS_LIVE=true server');
{
  const LIVE_PORT = Number(process.env.RSS_PORT || 4698);
  const LIVE_DB = `${DB_URI.replace(/\/+$/, '')}-rsslive`;
  const LB = `http://localhost:${LIVE_PORT}/api`;
  const lreq = client(LB);

  const items = [
    { guid: 'post-2', title: 'Second post', link: 'https://blog.test/2' },
    { guid: 'post-1', title: 'First post', link: 'https://blog.test/1' },
  ];
  const feedXml = () => `<?xml version="1.0"?><rss version="2.0"><channel><title>Test blog</title>${items.map((i) =>
    `<item><guid>${i.guid}</guid><title>${i.title}</title><link>${i.link}</link><pubDate>${new Date().toUTCString()}</pubDate><description>About ${i.title}</description></item>`).join('')}</channel></rss>`;
  const feed = http.createServer((rq, rs) => { rs.writeHead(200, { 'Content-Type': 'application/rss+xml' }); rs.end(feedXml()); });
  await new Promise((r) => feed.listen(0, '127.0.0.1', r));
  const FEED = `http://127.0.0.1:${feed.address().port}/feed.xml`;

  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: SERVER_ROOT,
    env: { ...process.env, PORT: String(LIVE_PORT), MONGODB_URI: LIVE_DB, INTEGRATIONS_LIVE: 'true', HTTP_TOOL_ALLOW_PRIVATE_NETWORKS: 'true', HTTP_TOOL_ALLOWED_HOSTS: '', PUBLIC_BASE_URL: `http://localhost:${LIVE_PORT}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childLog = '';
  child.stdout.on('data', (d) => { childLog += d; });
  child.stderr.on('data', (d) => { childLog += d; });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    await sleep(250);
    up = await fetch(`${LB}/health`).then((r) => r.ok, () => false);
  }
  check('private live server started', up, up ? '' : brief(childLog, 400));

  try {
    if (up) {
      const lo = await register(lreq, 'rssowner');
      const conn = await makeConnection(lreq, lo, { integration: 'rss', name: 'Test blog', mode: 'live', config: { feedUrl: FEED, pollMinutes: 5 } });
      check('RSS connection created (no inbound URL: poll-based)', conn.status === 201 && !conn.hookPath, `${conn.status} ${brief(conn.body)}`);
      const wf = await makeWorkflow(lreq, lo, 'on new post');
      await subscribe(lreq, lo, wf, 'rss.new_item', conn.id);

      const poll = () => lreq('POST', '/integrations/rss/poll', { body: { connectionId: conn.id }, token: lo.token, ws: lo.ws });
      const first = await poll();
      check('first poll only records what it sees (fires nothing)', first.status === 200 && first.body?.firstPoll === true && first.body?.triggered?.length === 0 && first.body?.fetched === 2, `${first.status} ${brief(first.body)}`);
      const again = await poll();
      check('a second poll with no new items fires nothing', again.body?.fresh === 0 && again.body?.triggered?.length === 0, brief(again.body));

      items.unshift({ guid: 'post-3', title: 'Third post', link: 'https://blog.test/3' });
      const third = await poll();
      check('one new item → exactly one run', third.body?.fresh === 1 && third.body?.triggered?.length === 1, brief(third.body));
      const run = third.body?.triggered?.[0] && await waitRun(lreq, lo, third.body.triggered[0]);
      check('the run\'s input is the rss.new_item envelope for the new item', run?.input?.event === 'rss.new_item' && run?.input?.data?.title === 'Third post' && run?.input?.data?.feedUrl === FEED, brief(run?.input));
      const repeat = await poll();
      check('the same item never fires twice', repeat.body?.triggered?.length === 0, brief(repeat.body));

      const reader = await makeWorkflow(lreq, lo, 'read feed', chain(toolNode('r', 'rss', 'read_feed', { connectionId: conn.id, params: { limit: 2 } })));
      const rr = await lreq('POST', `/workflows/${reader}/runs`, { token: lo.token, ws: lo.ws });
      const rdone = await waitRun(lreq, lo, rr.body?.runId);
      const rnode = rdone?.nodeResults?.find((n) => n.nodeId === 'r');
      check('rss.read_feed runs live and returns the latest items', rnode?.mode === 'live' && rnode?.output?.items?.[0]?.title === 'Third post' && rnode?.output?.items?.length === 2, brief(rnode));

      const sandboxConn = await makeConnection(lreq, lo, { integration: 'rss', name: 'Sandboxed feed', mode: 'sandbox', config: { feedUrl: FEED } });
      const sp = await lreq('POST', '/integrations/rss/poll', { body: { connectionId: sandboxConn.id }, token: lo.token, ws: lo.ws });
      check('a sandbox-mode RSS connection is never fetched', sp.body?.skipped === 'sandbox', brief(sp.body));
    }
  } finally {
    child.kill('SIGTERM');
    feed.close();
    const cleanup = await mongoose.createConnection(LIVE_DB).asPromise().catch(() => null);
    if (cleanup) { await cleanup.dropDatabase().catch(() => {}); await cleanup.close(); }
  }
}

await mongoose.disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
