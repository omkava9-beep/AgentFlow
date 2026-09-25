/**
 * Built-in template catalogue check - every template is real, valid and runs.
 *
 *   npm run check:template-catalog
 *
 * Self-contained: starts its own server on a free port against a throwaway
 * database (sandbox integrations, mock agents, no injected tool failures), seeds
 * the catalogue, and for every template:
 *   A. metadata and layout are complete (category, icon, summary, use case,
 *      difficulty, trigger, sample input, readable non-overlapping layout),
 *   B. the graph passes the server validator with zero errors and warnings,
 *   C. "Use template" creates the workflow (+ published companions, trigger
 *      pre-filled but disabled), which validates clean against the workspace,
 *   D. publishing and running it with its sampleInput ends in success -
 *      approvals are approved through the approvals API, delays are shortened.
 * Plus: seeding is idempotent and prunes retired built-ins, and a Code-node
 * template needs code:author to use.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { BUILT_IN_TEMPLATES, TEMPLATE_CATEGORIES, COMPANION_PREFIX, integrationsUsed } from '../templates/catalog.js';
import { validateGraph } from '../engine/validateGraph.js';
import { IntegrationRegistry } from '../integrations/IntegrationRegistry.js';
import { TEMPLATE_DIFFICULTIES, TEMPLATE_TRIGGER_TYPES } from '../models/Template.js';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE_URI = (process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/agentflow').replace(/\/+$/, '').replace(/\/[^/]*$/, '');
const RUN_TIMEOUT_MS = 60_000;
const MIN_NODE_DISTANCE = 140;

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail && !ok ? ` — ${detail}` : ''}`);
  if (ok) pass += 1; else fail += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = () => new Promise((resolve) => {
  const srv = net.createServer();
  srv.listen(0, () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

const catalog = IntegrationRegistry.list();
const catalogById = new Map(catalog.map((m) => [m.id, m]));
const main = BUILT_IN_TEMPLATES.filter((t) => !t.companion);
const companionsByKey = new Map(BUILT_IN_TEMPLATES.filter((t) => t.companion).map((t) => [t.key, t]));

// --------------------------------------------------------------- A + B: static
console.log(`A. catalogue metadata and layout (${BUILT_IN_TEMPLATES.length} templates, ${main.length} main + ${companionsByKey.size} companions)`);
{
  const keys = BUILT_IN_TEMPLATES.map((t) => t.key);
  const names = BUILT_IN_TEMPLATES.map((t) => t.name);
  check('keys are unique', new Set(keys).size === keys.length);
  check('names are unique', new Set(names).size === names.length);
  check(`at least 18 main templates (${main.length})`, main.length >= 18);
  const usedCategories = new Set(main.map((t) => t.category));
  check('every category has at least one template', TEMPLATE_CATEGORIES.every((c) => usedCategories.has(c)), TEMPLATE_CATEGORIES.filter((c) => !usedCategories.has(c)).join(', '));

  for (const t of BUILT_IN_TEMPLATES) {
    const problems = [];
    if (!TEMPLATE_CATEGORIES.includes(t.category)) problems.push(`category "${t.category}"`);
    if (!TEMPLATE_DIFFICULTIES.includes(t.difficulty)) problems.push(`difficulty "${t.difficulty}"`);
    if (!TEMPLATE_TRIGGER_TYPES.includes(t.triggerType)) problems.push(`triggerType "${t.triggerType}"`);
    if (!t.icon) problems.push('no icon');
    if (!t.summary || t.summary.length > 140) problems.push('summary missing or longer than 140 chars');
    if (!t.useCase || t.useCase.length < 80) problems.push('use case missing or too short');
    if (!(t.estimatedSetupMinutes > 0)) problems.push('no setup estimate');
    if (!t.sampleInput || typeof t.sampleInput !== 'object') problems.push('no sampleInput');
    const unknown = t.requiredIntegrations.filter((id) => !catalogById.has(id));
    if (unknown.length) problems.push(`unknown integrations ${unknown.join(',')}`);
    const undeclared = integrationsUsed(t.nodes).filter((id) => !t.requiredIntegrations.includes(id));
    if (undeclared.length) problems.push(`uses but doesn't declare ${undeclared.join(',')}`);
    if (t.trigger.type === 'event') {
      const [integration, triggerId] = String(t.trigger.eventName || '').split('.');
      if (!catalogById.get(integration)?.triggers?.some((tr) => tr.id === triggerId)) problems.push(`unknown event ${t.trigger.eventName}`);
      if (t.sampleInput.event !== t.trigger.eventName || !t.sampleInput.data) problems.push('event sampleInput is not an event envelope');
    }
    if (t.trigger.type === 'schedule' && !/^(\S+\s+){4}\S+$/.test(t.trigger.cronExpression || '')) problems.push('bad cron');
    for (const n of t.nodes) if (!String(n.data?.config?.label || '').trim()) problems.push(`node ${n.id} has no label`);
    for (let i = 0; i < t.nodes.length; i += 1) {
      for (let j = i + 1; j < t.nodes.length; j += 1) {
        const a = t.nodes[i].position;
        const b = t.nodes[j].position;
        if (Math.hypot(a.x - b.x, a.y - b.y) < MIN_NODE_DISTANCE) problems.push(`nodes ${t.nodes[i].id}/${t.nodes[j].id} overlap`);
      }
    }
    for (const key of t.companions) if (!companionsByKey.has(key)) problems.push(`missing companion ${key}`);
    for (const n of t.nodes) {
      const ref = n.data?.config?.workflowId;
      if (['loop', 'subworkflow'].includes(n.type)) {
        if (!String(ref || '').startsWith(COMPANION_PREFIX) || !t.companions.includes(ref.slice(COMPANION_PREFIX.length))) {
          problems.push(`${n.id} doesn't reference a declared companion`);
        }
      }
    }
    check(`${t.name}: metadata, integrations and layout`, problems.length === 0, problems.join('; '));
  }
}

console.log('\nB. every template passes the server validator with zero errors and zero warnings');
for (const t of BUILT_IN_TEMPLATES) {
  const { errors, warnings } = validateGraph({ nodes: t.nodes, edges: t.edges, integrations: catalog });
  check(`${t.name} (${t.nodes.length} nodes)`, errors.length === 0 && warnings.length === 0, [...errors, ...warnings].map((p) => p.message).join(' | '));
}

// --------------------------------------------------------------- seeding
const port = await freePort();
const dbUri = `${BASE_URI}/agentflow-templatecatalog-${port}`;
await mongoose.connect(dbUri);
await mongoose.connection.dropDatabase();

console.log('\nseeding is idempotent and prunes retired built-ins');
{
  const { seedBuiltInTemplates } = await import('./seedTemplates.js');
  const Template = mongoose.model('Template');
  await Template.create({ workspaceId: null, name: 'Summarize & Notify', nodes: [], edges: [] });
  const first = await seedBuiltInTemplates();
  const second = await seedBuiltInTemplates();
  const count = await Template.countDocuments({ workspaceId: null });
  check(`every built-in upserted (${first.upserted})`, first.upserted === BUILT_IN_TEMPLATES.length);
  check('the retired phase-1 template was pruned', first.pruned === 1 && !(await Template.exists({ name: 'Summarize & Notify' })));
  check('second seed changes nothing', second.pruned === 0 && count === BUILT_IN_TEMPLATES.length, `count ${count}`);
}

// --------------------------------------------------------------- server
const server = spawn(process.execPath, ['src/index.js'], {
  cwd: SERVER_DIR,
  env: {
    ...process.env,
    PORT: String(port),
    MONGODB_URI: dbUri,
    INTEGRATIONS_LIVE: 'false',
    AGENT_PROVIDER: 'mock',
    DEFAULT_TOOL_FAILURE_RATE: '0',
    PUBLIC_BASE_URL: `http://localhost:${port}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const B = `http://localhost:${port}/api`;

async function req(method, p, { body, token, ws } = {}) {
  const res = await fetch(`${B}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...(ws && { 'X-Workspace-Id': ws }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  let json = null;
  try { json = await res.json(); } catch { /* 204 */ }
  return { status: res.status, body: json };
}

async function cleanup(code) {
  server.kill('SIGTERM');
  await sleep(300);
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exit(code);
}

try {
  let up = false;
  for (let i = 0; i < 80 && !up; i += 1) {
    up = await fetch(`${B}/health`).then((r) => r.ok).catch(() => false);
    if (!up) await sleep(250);
  }
  if (!up) { console.log(serverLog.slice(-2000)); throw new Error('server did not start'); }

  const email = `owner${Date.now()}@catalog.test`;
  const reg = await req('POST', '/auth/register', { body: { email, password: 'password123', name: 'Catalog Owner' } });
  const token = reg.body.token;
  const WS = reg.body.workspaces[0].id;
  const O = { token, ws: WS };
  // Enterprise so a catalogue's worth of runs and loop children never hit the Free quota.
  await req('PATCH', `/workspaces/${WS}/plan`, { ...O, body: { plan: 'enterprise' } });

  const list = await req('GET', '/templates', O);
  const byKey = new Map((list.body || []).filter((t) => t.builtIn).map((t) => [t.key, t]));
  console.log('\nC. the API exposes the gallery fields');
  {
    const t = byKey.get('failed-payment-recovery');
    check('list carries every built-in', byKey.size === BUILT_IN_TEMPLATES.length, `${byKey.size}`);
    check('list is in catalogue order, companions last', (list.body || []).filter((x) => x.builtIn).map((x) => x.key).join() === BUILT_IN_TEMPLATES.map((x) => x.key).join());
    check('fields: category, icon, summary, useCase, difficulty, trigger, sampleInput, integrations',
      t && t.category === 'Revenue & billing' && t.icon && t.summary && t.useCase && t.difficulty && t.triggerType === 'event'
        && t.trigger?.eventName === 'stripe.payment_failed' && t.sampleInput?.data?.amount && t.integrationsUsed.includes('stripe') === false
        && t.requiredIntegrations.includes('stripe'), JSON.stringify(t && { ...t, nodes: undefined, edges: undefined }).slice(0, 300));
    const churn = byKey.get('churn-risk-scoring');
    check('usesCode is true for a template whose companion has a Code node', churn?.usesCode === true && t?.usesCode === false);
    const detail = await req('GET', `/templates/${churn._id}`, O);
    check('detail lists companion templates', detail.status === 200 && detail.body.companionTemplates?.[0]?.key === 'score-one-customer', `${detail.status}`);
  }

  // ----------------------------------------------------------- D: use + run
  console.log('\nD. every template: use → validate → publish → run with its sample input');
  const workflows = async () => (await req('GET', '/workflows', O)).body || [];

  async function runToEnd(workflowId, input, name) {
    const started = await req('POST', `/workflows/${workflowId}/runs`, { ...O, body: { source: 'published', input } });
    if (started.status !== 202) return { error: `run start ${started.status} ${started.body?.error}` };
    const runId = started.body.runId;
    const approved = new Set();
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const run = (await req('GET', `/runs/${runId}`, O)).body;
      if (['success', 'failed', 'cancelled'].includes(run.status)) return { run };
      if (run.status === 'waiting') {
        for (const r of run.nodeResults || []) {
          if (r.status === 'waiting' && r.approval && !approved.has(r.nodeId)) {
            const d = await req('POST', `/runs/${runId}/approvals/${r.nodeId}`, { ...O, body: { decision: 'approve', comment: `Catalogue check approves ${name}` } });
            if (d.status !== 200) return { error: `approve ${r.nodeId}: ${d.status} ${d.body?.error}` };
            approved.add(r.nodeId);
          }
        }
      }
      await sleep(200);
    }
    return { error: `run ${runId} did not finish in ${RUN_TIMEOUT_MS / 1000}s` };
  }

  const summary = [];
  for (const t of BUILT_IN_TEMPLATES) {
    const tpl = byKey.get(t.key);
    const used = await req('POST', `/templates/${tpl._id}/use`, O);
    if (used.status !== 201) { check(`${t.name}: use`, false, `${used.status} ${used.body?.error}`); continue; }
    const wf = used.body;
    const problems = [];

    // Companions: created, published and wired in.
    if (t.companions.length) {
      if (used.body.companions?.length !== t.companions.length) problems.push('companions not created');
      const all = await workflows();
      for (const c of used.body.companions || []) {
        const cw = all.find((w) => String(w._id) === String(c._id));
        if (!cw || !(cw.publishedVersion >= 1 || cw.publishedVersionNumber >= 1 || cw.published)) {
          const full = (await req('GET', `/workflows/${c._id}`, O)).body;
          if (!full?.publishedVersionId) problems.push(`companion ${c.name} not published`);
        }
      }
      for (const n of wf.nodes.filter((x) => ['loop', 'subworkflow'].includes(x.type))) {
        if (!used.body.companions.some((c) => String(c._id) === String(n.data.config.workflowId))) problems.push(`${n.id} not wired to its companion`);
      }
    }
    // Trigger pre-filled, never enabled.
    if (t.trigger.type === 'event' && (wf.eventTrigger?.eventName !== t.trigger.eventName || wf.eventTrigger?.enabled)) problems.push('event trigger not pre-filled (disabled)');
    if (t.trigger.type === 'schedule' && (wf.schedule?.cronExpression !== t.trigger.cronExpression || wf.schedule?.enabled)) problems.push('schedule not pre-filled (disabled)');
    if (wf.nodes.some((n) => n.data?.config?.connectionId)) problems.push('connection ids leaked into the clone');

    // Validates clean against the real workspace (companions published).
    const all = await workflows();
    const v = validateGraph({ nodes: wf.nodes, edges: wf.edges, integrations: catalog, workflows: all, currentWorkflowId: wf._id });
    if (v.errors.length || v.warnings.length) problems.push(`validation: ${[...v.errors, ...v.warnings].map((p) => p.message).join(' | ')}`);

    // Delays are real (up to a day) - shorten them for the check.
    if (wf.nodes.some((n) => n.type === 'delay')) {
      const nodes = wf.nodes.map((n) => (n.type === 'delay' ? { ...n, data: { config: { ...n.data.config, durationMs: 50 } } } : n));
      const put = await req('PUT', `/workflows/${wf._id}`, { ...O, body: { nodes, edges: wf.edges } });
      if (put.status !== 200) problems.push(`shorten delay: ${put.status}`);
    }
    const pub = await req('POST', `/workflows/${wf._id}/publish`, { ...O, body: { message: 'Catalogue check', acknowledgeWarnings: true } });
    if (pub.status !== 201) problems.push(`publish ${pub.status} ${pub.body?.error}`);

    const { run, error } = await runToEnd(wf._id, t.sampleInput, t.name);
    if (error) problems.push(error);
    if (run) {
      if (run.status !== 'success') {
        const failed = (run.nodeResults || []).filter((r) => r.status === 'failed').map((r) => `${r.nodeId}: ${(r.logs || []).slice(-1)[0] || r.error || ''}`);
        problems.push(`run ${run.status} (${failed.join('; ')})`);
      }
      // A scheduled template's sample input is empty, like a real cron tick, and is stored as no input.
      const expected = Object.keys(t.sampleInput).length ? t.sampleInput : null;
      if (JSON.stringify(run.input ?? null) !== JSON.stringify(expected)) problems.push('run input is not the sample input');
      const counts = (run.nodeResults || []).reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
      summary.push({ name: t.name, status: run.status, counts, handled: (run.nodeResults || []).filter((r) => r.handled).map((r) => r.nodeId) });
    }
    check(`${t.name}`, problems.length === 0, problems.join('; '));
  }

  console.log('\nE. behaviour worth pinning');
  {
    const refund = summary.find((s) => s.name === 'Refund request approval');
    check('refund template: the sandbox refund fails and its error branch handles it', refund?.status === 'success' && refund.handled.includes('refund'), JSON.stringify(refund));
    const payment = summary.find((s) => s.name === 'Failed payment recovery');
    check('failed-payment template ran through the approval path', payment?.status === 'success' && (payment.counts.success || 0) >= 7, JSON.stringify(payment));
    check('every main template ended in success', summary.filter((s) => !companionsByKey.has(BUILT_IN_TEMPLATES.find((t) => t.name === s.name)?.key)).every((s) => s.status === 'success'));
  }

  console.log('\nF. a Code-node template needs code:author to use');
  {
    const editorEmail = `editor${Date.now()}@catalog.test`;
    const inv = await req('POST', `/workspaces/${WS}/invitations`, { ...O, body: { email: editorEmail, role: 'editor' } });
    const editor = await req('POST', '/auth/register', { body: { email: editorEmail, password: 'password123', name: 'Catalog Editor' } });
    const inviteToken = String(inv.body?.inviteUrl || '').split('/invite/').pop();
    const accepted = await req('POST', `/invitations/${inviteToken}/accept`, { token: editor.body.token });
    const E = { token: editor.body.token, ws: WS };
    check('editor joined the workspace', accepted.status === 200, `${inv.status} ${accepted.status}`);
    const churn = await req('POST', `/templates/${byKey.get('churn-risk-scoring')._id}/use`, E);
    check('editor using a template whose companion has a Code node → 403', churn.status === 403, `${churn.status} ${churn.body?.error}`);
    const plain = await req('POST', `/templates/${byKey.get('failed-payment-recovery')._id}/use`, E);
    check('editor can use a template without code → 201', plain.status === 201, `${plain.status}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await cleanup(fail ? 1 : 0);
} catch (err) {
  console.error(err);
  console.log(serverLog.slice(-3000));
  await cleanup(1);
}
