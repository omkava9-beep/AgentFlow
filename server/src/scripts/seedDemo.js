/**
 * `npm run seed:demo` — builds PHASE_3_SCOPE.md's demo script in one command
 * (spec/36 §3): two tenants, a team with roles, sandbox connections, the
 * published "Payment triage" workflow (v1–v3), 14 days of run history, a
 * waiting approval for Bob, a comment that @mentions Alice, and an API key.
 *
 * How it stays honest: everything a user could do is done through the real
 * REST API (the app is started in-process on a random port), so validation,
 * audit events, notifications and the Outbox are genuine. Only the backfilled
 * history (runs and usage counters in the past) is written directly.
 *
 * Safety: it only ever deletes workspaces flagged `demo: true` and the demo
 * users (all on the reserved `.test` TLD), so it's re-runnable and never
 * touches anyone else's data. It forces INTEGRATIONS_LIVE=false for its own
 * process and creates sandbox connections only, so seeding never posts to a
 * real service.
 */

// Before any app module reads its config: the seed itself never goes live.
process.env.INTEGRATIONS_LIVE = 'false';

const { default: http } = await import('node:http');
const { spawnSync } = await import('node:child_process');
const { default: mongoose } = await import('mongoose');
const { env } = await import('../config/env.js');
const { createApp } = await import('../app.js');
const { default: User } = await import('../models/User.js');
const { default: Workspace } = await import('../models/Workspace.js');
const { default: Membership } = await import('../models/Membership.js');
const { default: Run } = await import('../models/Run.js');
const { default: Template } = await import('../models/Template.js');
const { default: WorkflowVersion } = await import('../models/WorkflowVersion.js');
const { default: UsageCounter } = await import('../models/UsageCounter.js');
const { default: OutboxMessage } = await import('../models/OutboxMessage.js');
const { default: Notification } = await import('../models/Notification.js');
const { default: WorkflowWatch } = await import('../models/WorkflowWatch.js');
const { deleteWorkspace } = await import('../tenancy/deleteWorkspace.js');
const { IntegrationRegistry } = await import('../integrations/IntegrationRegistry.js');
const { hub } = await import('../collab/hub.js');
const { flushUsage } = await import('../services/usage.js');
const { mcpPool } = await import('../mcp/McpPool.js');
const { stopRssPollers } = await import('../scheduler/rssPoller.js');

const PASSWORD = 'demo-password';
const PEOPLE = {
  alice: { email: 'alice@acme.test', name: 'Alice Anders' },
  bob: { email: 'bob@acme.test', name: 'Bob Brooks' },
  victor: { email: 'victor@acme.test', name: 'Victor Vale' },
  carol: { email: 'carol@globex.test', name: 'Carol Chen' },
};
const PENDING_INVITE = 'dana@acme.test';
const DEMO_EMAILS = [...Object.values(PEOPLE).map((p) => p.email), PENDING_INVITE];
const HISTORY_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

const notes = [];
const note = (line) => { notes.push(line); console.log(`  · ${line}`); };
const skip = (what, why) => note(`skipped ${what}: ${why}`);

// Deterministic randomness, so two seeds produce the same-looking history.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260925);
const between = (min, max) => Math.round(min + rand() * (max - min));
const pick = (list) => list[Math.floor(rand() * list.length)];
const chance = (p) => rand() < p;

// ------------------------------------------------------------------ cleanup

async function removePreviousDemo() {
  const users = await User.find({ email: { $in: DEMO_EMAILS } }).select('_id').lean();
  const userIds = users.map((u) => u._id);
  const flagged = await Workspace.find({ demo: true }).select('_id').lean();
  // A demo user's personal workspace predates the flag if an earlier seed
  // crashed halfway, so it's matched by creator too.
  const personal = await Workspace.find({ personal: true, createdBy: { $in: userIds } }).select('_id').lean();
  const ids = [...new Set([...flagged, ...personal].map((w) => String(w._id)))];
  for (const id of ids) await deleteWorkspace(id);

  // What's left belongs to the demo users themselves.
  await Membership.deleteMany({ userId: { $in: userIds } });
  await Notification.deleteMany({ userId: { $in: userIds } });
  await WorkflowWatch.deleteMany({ userId: { $in: userIds } });
  await OutboxMessage.deleteMany({ to: { $in: DEMO_EMAILS } });
  await User.deleteMany({ _id: { $in: userIds } });
  return { workspaces: ids.length, users: userIds.length };
}

// ------------------------------------------------------------------ REST client

let BASE = '';
async function api(method, path, { token, ws, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(ws && { 'X-Workspace-Id': ws }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, ok: res.ok, body: data };
}
async function must(label, promise) {
  const r = await promise;
  if (!r.ok) throw new Error(`${label} failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

// ------------------------------------------------------------------ graph helpers

// Graphs below are laid out on a 220px grid; nodes are 248px wide on the canvas,
// so x is stretched to leave room for edges and labels between columns.
const X_SPACING = 1.5;
const N = (id, type, x, y, config = {}) => ({ id, type, position: { x: Math.round(x * X_SPACING), y }, data: { config: { label: id, ...config } } });
const E = (source, target, extra = {}) => ({ id: `${source}->${target}${extra.sourceHandle ? `:${extra.sourceHandle}` : ''}`, source, target, ...extra });
const tool = (id, x, y, label, integration, action, params = {}, connectionId = null) =>
  N(id, 'tool', x, y, { label, integration, action, connectionId, params, mockOverrides: {} });

function paymentTriage(version, ids) {
  const nodes = [
    N('s', 'start', 0, 200, { label: 'Stripe: payment failed' }),
    N('ex', 'transform', 220, 200, {
      label: 'Extract payment',
      mode: 'replace',
      mappings: [
        { key: 'id', value: '{{input.data.customer}}' },
        { key: 'customer', value: '{{input.data.customer}}' },
        { key: 'amount', value: '{{input.data.amount}}' },
        { key: 'currency', value: '{{input.data.currency}}' },
        { key: 'paymentId', value: '{{input.data.paymentId}}' },
        { key: 'reason', value: '{{input.data.failureMessage}}' },
      ],
    }),
  ];
  const edges = [E('s', 'ex')];
  const threshold = version >= 3 ? 10000 : 5000;
  let condFrom = 'ex';
  let condX = 440;

  if (version >= 2) {
    nodes.push(
      N('ag', 'agent', 440, 200, {
        label: 'Triage agent',
        systemPrompt: 'You triage failed card payments. Look the customer up with lookup_customer, optionally check the payment with an HTTP request, and summarise the risk in two sentences.',
        tools: [
          { integration: 'mcp', action: 'lookup_customer', connectionId: ids.mcp },
          { integration: 'http', action: 'request', connectionId: null },
        ],
        allowSideEffects: true,
      }),
      N('cs', 'transform', 660, 200, {
        label: 'Case summary',
        mode: 'replace',
        mappings: [
          { key: 'amount', value: '{{run.input.data.amount}}' },
          { key: 'paymentId', value: '{{run.input.data.paymentId}}' },
          { key: 'customer', value: '{{run.input.data.customer}}' },
          { key: 'summary', value: '{{input.reply}}' },
        ],
      }),
    );
    edges.push(E('ex', 'ag'), E('ag', 'cs'));
    condFrom = 'cs';
    condX = 880;
  }

  nodes.push(N('cond', 'condition', condX, 200, { label: `Over $${threshold / 100}?`, expression: `output.amount > ${threshold}` }));
  edges.push(E(condFrom, 'cond'));

  const slackAuto = tool('slAuto', condX + 220, 380, 'Tell #payments (auto-retry)', 'slack', 'post_message',
    { channel: '#payments', text: 'Small failed payment - Stripe will retry automatically.' }, ids.slack);
  nodes.push(slackAuto);
  edges.push(E('cond', 'slAuto', { sourceHandle: 'false', label: 'no' }));

  const endX = condX + 880;
  if (version === 1) {
    nodes.push(tool('slA', condX + 220, 80, 'Tell #payments (needs a look)', 'slack', 'post_message',
      { channel: '#payments', text: 'Large failed payment - someone please take a look.' }, ids.slack));
    edges.push(E('cond', 'slA', { sourceHandle: 'true', label: 'yes' }));
  } else {
    nodes.push(
      N('ap', 'approval', condX + 220, 80, {
        label: 'Refund approval',
        title: 'Refund failed payment {{input.paymentId}}?',
        description: '{{input.summary}}',
        assignees: { userIds: [ids.bob], roles: [] },
        minApprovals: 1,
      }),
      tool('slA', condX + 440, 0, 'Tell #payments (approved)', 'slack', 'post_message',
        { channel: '#payments', text: 'Refund approved for a failed payment.' }, ids.slack),
      tool('slR', condX + 440, 200, 'Tell #payments (declined)', 'slack', 'post_message',
        { channel: '#payments', text: 'Refund declined - the customer will be contacted.' }, ids.slack),
    );
    edges.push(
      E('cond', 'ap', { sourceHandle: 'true', label: 'yes' }),
      E('ap', 'slA', { sourceHandle: 'approved' }),
      E('ap', 'slR', { sourceHandle: 'rejected' }),
      E('slR', 'e'),
    );
    if (version >= 3) {
      nodes.push(tool('gh', condX + 660, 0, 'Open follow-up issue', 'github', 'create_issue',
        { repo: 'acme/payments', title: 'Follow up failed payment', body: 'Opened by AgentFlow after an approved refund.', labels: 'payments, triage' }, ids.github));
      edges.push(E('slA', 'gh'), E('gh', 'e'));
    } else {
      edges.push(E('slA', 'e'));
    }
  }
  if (version === 1) edges.push(E('slA', 'e'));
  edges.push(E('slAuto', 'e'));
  nodes.push(N('e', 'end', endX, 200, { label: 'Done' }));
  return { nodes, edges };
}

// ------------------------------------------------------------------ history

const INTEGRATION_OUTPUTS = (integration, action) => {
  try {
    return IntegrationRegistry.getAction(integration, action)?.outputSample ?? { ok: true };
  } catch {
    return { ok: true };
  }
};

function topo(nodes, edges) {
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) indeg.set(e.target, (indeg.get(e.target) || 0) + 1);
  const queue = nodes.filter((n) => !indeg.get(n.id)).map((n) => n.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const e of edges.filter((x) => x.source === id)) {
      indeg.set(e.target, indeg.get(e.target) - 1);
      if (indeg.get(e.target) === 0) queue.push(e.target);
    }
  }
  return order;
}

/**
 * A plausible past execution of `graph`: statuses follow spec/19's fan-in rule
 * (a node runs if any incoming edge is live), conditions and approvals pick a
 * branch, ~6% of work nodes fail after retries, and error edges catch them.
 */
function simulate(graph, { start, input, bobId, failProb = 0.06, approveProb = 0.75, conditionTrue = 0.6 }) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const status = new Map();
  const pruned = new Set();
  const results = [];
  const usage = { nodeExecutions: 0, sandbox: 0, live: 0, mcp: 0, agent: 0, hits: 0, misses: 0, queueWait: 0 };
  let clock = start.getTime() + between(5, 60);
  let failed = false;

  for (const id of topo(graph.nodes, graph.edges)) {
    const node = byId.get(id);
    const cfg = node.data?.config || {};
    const incoming = graph.edges.filter((e) => e.target === id);
    const live = incoming.filter((e) => status.get(e.source) === 'ok' && !pruned.has(e.id))
      .concat(incoming.filter((e) => status.get(e.source) === 'handled' && e.sourceHandle === 'error'));
    const nodeStart = new Date(clock);
    if (incoming.length && !live.length) {
      status.set(id, 'skipped');
      results.push({ nodeId: id, status: 'skipped', logs: [] });
      continue;
    }
    const isWork = ['agent', 'tool', 'code'].includes(node.type);
    const queuedMs = isWork ? (chance(0.15) ? between(400, 2500) : between(0, 120)) : 0;
    let durationMs = isWork ? between(180, 950) : between(1, 15);
    const r = { nodeId: id, status: 'success', logs: [], attempts: 1, startedAt: nodeStart };
    if (isWork) { r.queuedMs = queuedMs; usage.queueWait += queuedMs; usage.nodeExecutions += 1; }

    if (isWork && chance(failProb)) {
      const hasErrorEdge = graph.edges.some((e) => e.source === id && e.sourceHandle === 'error');
      r.status = 'failed';
      r.attempts = 3;
      r.logs = ['[simulated failure] upstream call failed (attempt 1/3), retrying in 500ms...', '[simulated failure] upstream call failed (attempt 2/3), retrying in 1000ms...', 'upstream call failed after 3 attempts'];
      durationMs += 1500;
      if (hasErrorEdge) {
        r.handled = true;
        status.set(id, 'handled');
        for (const e of graph.edges.filter((x) => x.source === id && x.sourceHandle !== 'error')) pruned.add(e.id);
      } else {
        status.set(id, 'failed');
        failed = true;
      }
    } else {
      status.set(id, 'ok');
      if (node.type === 'start') r.output = input;
      else if (node.type === 'transform') r.output = { ...(input?.data || {}), summary: 'High-value customer; card declined twice this month.' };
      else if (node.type === 'condition') {
        const taken = chance(conditionTrue);
        r.output = { taken };
        for (const e of graph.edges.filter((x) => x.source === id && x.sourceHandle !== (taken ? 'true' : 'false'))) pruned.add(e.id);
      } else if (node.type === 'approval') {
        const decision = chance(approveProb) ? 'approved' : 'rejected';
        const waitedMs = between(3, 90) * 60_000;
        durationMs = waitedMs;
        r.output = { decision, decidedBy: String(bobId), comment: decision === 'approved' ? 'Long-standing customer, refund it.' : 'Third failure this month - contact them first.' };
        r.approval = {
          title: cfg.title || 'Approval', assigneeIds: [String(bobId)], assigneeNames: { [String(bobId)]: PEOPLE.bob.name }, minApprovals: 1,
          approvals: [{ userId: String(bobId), name: PEOPLE.bob.name, decision, at: new Date(clock + waitedMs), via: 'app' }],
          decision, decidedBy: String(bobId), decidedByName: PEOPLE.bob.name, decidedAt: new Date(clock + waitedMs), comment: r.output.comment,
        };
        r.waitingSince = nodeStart;
        for (const e of graph.edges.filter((x) => x.source === id && x.sourceHandle !== decision)) pruned.add(e.id);
      } else if (node.type === 'agent') {
        usage.agent += 1;
        const calls = (cfg.tools || []).filter((t) => t.integration === 'mcp').slice(0, 1);
        r.toolCalls = calls.map((t, i) => ({
          step: 1, callId: `seed-${i}`, tool: { integration: t.integration, action: t.action, connectionId: t.connectionId, name: t.action },
          args: { id: input?.data?.customer || '42' }, status: 'success', output: { id: input?.data?.customer || '42', name: 'Maya Chen', tier: 'gold' },
          cached: false, attempts: 1, sandbox: false, startedAt: new Date(clock + 50), durationMs: between(8, 40),
        }));
        r.agentSteps = calls.length;
        usage.mcp += calls.length;
        r.output = { reply: `Triage agent used ${calls.length} tool call — lookup_customer(id: ${input?.data?.customer || '42'}) → name: Maya Chen, tier: gold`, toolsUsed: calls.map((c) => c.action) };
      } else if (node.type === 'tool') {
        const action = IntegrationRegistry.getAction(cfg.integration, cfg.action);
        r.integration = cfg.integration;
        r.action = cfg.action;
        r.mode = cfg.integration === 'mcp' ? 'live' : 'sandbox';
        const cacheable = Boolean(action?.cacheable);
        if (cacheable && chance(0.3)) { r.cached = true; durationMs = between(1, 4); usage.hits += 1; } else {
          if (cacheable) usage.misses += 1;
          if (r.mode === 'live') usage.live += 1; else usage.sandbox += 1;
        }
        r.output = INTEGRATION_OUTPUTS(cfg.integration, cfg.action);
      } else if (node.type === 'code') r.output = { amount: input?.amount ?? 4200, risk: 'low' };
      else if (node.type === 'loop') { r.output = { count: 30, succeeded: 30, failed: 0 }; r.progress = { done: 30, total: 30 }; durationMs = between(9000, 22000); }
      else if (node.type === 'end') r.output = { done: true };
    }
    if (node.type === 'tool' && r.status === 'failed') { r.integration = cfg.integration; r.action = cfg.action; r.mode = 'sandbox'; }
    clock += queuedMs + durationMs;
    r.durationMs = durationMs;
    r.finishedAt = new Date(clock);
    results.push(r);
  }
  return { nodeResults: results, status: failed ? 'failed' : 'success', finishedAt: new Date(clock), usage };
}

async function backfill({ workspaceId, workflow, versions, perDay, triggers, people, apiKeyId = null, inputFor }) {
  const docs = [];
  const perDayUsage = new Map();
  const now = Date.now();
  for (let d = HISTORY_DAYS - 1; d >= 0; d--) {
    const dayStart = new Date(new Date(now - d * DAY_MS).setUTCHours(0, 0, 0, 0));
    // Newest versions for the most recent days, so the version badge moves.
    const vIndex = Math.min(versions.length - 1, Math.floor(((HISTORY_DAYS - 1 - d) / HISTORY_DAYS) * versions.length));
    const version = versions[vIndex];
    const count = between(perDay[0], perDay[1]);
    for (let i = 0; i < count; i++) {
      let start = new Date(dayStart.getTime() + between(7, 20) * 3600_000 + between(0, 3599) * 1000);
      if (start.getTime() > now - 5 * 60_000) start = new Date(now - between(10, 120) * 60_000);
      const trigger = pick(triggers);
      const input = inputFor(trigger);
      const sim = simulate(version, { start, input, bobId: people.bob });
      const day = start.toISOString().slice(0, 10);
      const u = perDayUsage.get(day) || { runs: 0, nodeExecutions: 0, live: 0, sandbox: 0, mcp: 0, agent: 0, hits: 0, misses: 0, queueWait: 0 };
      u.runs += 1;
      for (const k of Object.keys(sim.usage)) u[k] += sim.usage[k];
      perDayUsage.set(day, u);
      docs.push(new Run({
        workflowId: workflow._id,
        workspaceId,
        triggeredBy: trigger === 'manual' ? pick([people.alice, people.bob]) : null,
        status: sim.status,
        failReason: sim.status === 'failed' ? 'nodes_failed' : null,
        trigger,
        apiKeyId: trigger === 'api' ? apiKeyId : null,
        isDraft: false,
        versionId: version._id,
        versionNumber: version.version,
        input,
        startedAt: start,
        finishedAt: sim.finishedAt,
        nodeResults: sim.nodeResults,
        createdAt: start,
        updatedAt: sim.finishedAt,
      }).toObject());
    }
  }
  if (docs.length) await Run.collection.insertMany(docs);
  for (const [day, u] of perDayUsage) {
    await UsageCounter.updateOne(
      { workspaceId, day },
      { $inc: {
        runs: u.runs, nodeExecutions: u.nodeExecutions, 'integrationCalls.live': u.live, 'integrationCalls.sandbox': u.sandbox,
        mcpCalls: u.mcp, 'agentCalls.mock': u.agent, cacheHits: u.hits, cacheMisses: u.misses, queueWaitMsTotal: u.queueWait,
      } },
      { upsert: true },
    );
  }
  return docs.length;
}

const stripeInput = () => {
  const amount = pick([1900, 4900, 7900, 12900, 24900, 3900, 15900]);
  return {
    event: 'stripe.payment_failed', integration: 'stripe', connectionId: null, test: false, receivedAt: new Date().toISOString(),
    data: { paymentId: `pi_${Math.random().toString(36).slice(2, 12)}`, amount, currency: 'usd', customer: `cus_${Math.random().toString(36).slice(2, 12)}`, status: 'requires_payment_method', failureMessage: pick(['Your card was declined.', 'Insufficient funds.', 'Your card has expired.']) },
  };
};

// ------------------------------------------------------------------ main

async function main() {
  console.log(`seed:demo → ${env.mongodbUri.replace(/\/\/[^@]*@/, '//***@')}`);
  await mongoose.connect(env.mongodbUri);

  const removed = await removePreviousDemo();
  note(`removed previous demo data: ${removed.workspaces} workspace(s), ${removed.users} user(s)`);

  if (!(await Template.countDocuments({ workspaceId: null }))) {
    const r = spawnSync(process.execPath, ['src/scripts/seedTemplates.js'], { env: process.env, stdio: 'ignore' });
    note(r.status === 0 ? 'seeded built-in templates' : 'could not seed built-in templates');
  }

  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  BASE = `http://127.0.0.1:${server.address().port}/api`;

  // ---------------------------------------------------------------- people
  const auth = {};
  for (const [key, p] of Object.entries(PEOPLE)) {
    const r = await must(`register ${p.email}`, api('POST', '/auth/register', { body: { email: p.email, password: PASSWORD, name: p.name } }));
    auth[key] = { token: r.token, id: r.user.id, personal: r.workspaces?.[0]?.id };
  }
  const ids = { alice: auth.alice.id, bob: auth.bob.id, victor: auth.victor.id, carol: auth.carol.id };

  const acme = await must('create Acme', api('POST', '/workspaces', { token: auth.alice.token, body: { name: 'Acme' } }));
  const globex = await must('create Globex', api('POST', '/workspaces', { token: auth.carol.token, body: { name: 'Globex' } }));
  const A = { token: auth.alice.token, ws: acme.id };
  const G = { token: auth.carol.token, ws: globex.id };
  // Flag immediately, so a crash from here on is still cleaned up next run.
  await Workspace.updateMany({ _id: { $in: [acme.id, globex.id, ...Object.values(auth).map((a) => a.personal).filter(Boolean)] } }, { $set: { demo: true } });

  const plan = await api('PATCH', `/workspaces/${acme.id}/plan`, { token: A.token, body: { plan: 'team' } });
  if (plan.ok) note('Acme is on the Team plan'); else skip('Team plan', `${plan.status}`);

  // ---------------------------------------------------------------- team
  for (const [who, role] of [['bob', 'editor'], ['victor', 'viewer']]) {
    const inv = await must(`invite ${who}`, api('POST', `/workspaces/${acme.id}/invitations`, { token: A.token, body: { email: PEOPLE[who].email, role } }));
    const token = String(inv.inviteUrl).split('/invite/').pop();
    await must(`accept ${who}`, api('POST', `/invitations/${token}/accept`, { token: auth[who].token }));
  }
  const dana = await api('POST', `/workspaces/${acme.id}/invitations`, { token: A.token, body: { email: PENDING_INVITE, role: 'editor' } });
  note(dana.ok ? `pending invite for ${PENDING_INVITE} is in the Outbox` : `could not invite ${PENDING_INVITE} (${dana.status})`);

  // ---------------------------------------------------------------- connections
  const conn = {};
  const connections = [
    ['stripe', 'stripe', 'Stripe (test mode)', { secretKey: 'sk_test_demo_not_a_real_key' }, {}],
    ['slack', 'slack', 'Slack #payments — paste a real incoming-webhook URL and switch to live for the demo', { webhookUrl: 'https://hooks.slack.com/services/T00000000/B00000000/demo-not-real' }, {}],
    ['github', 'github', 'GitHub acme/payments', { token: 'github_pat_demo_not_a_real_token' }, {}],
    ['mcp', 'mcp', 'AgentFlow demo tools (MCP)', {}, { transport: 'stdio', allowlistId: 'agentflow-demo' }],
  ];
  for (const [key, integration, name, credentials, config] of connections) {
    const r = await api('POST', `/workspaces/${acme.id}/connections`, { token: A.token, body: { integration, name, mode: 'sandbox', credentials, config } });
    if (r.ok) conn[key] = r.body.id; else skip(`${integration} connection`, `${r.status} ${JSON.stringify(r.body)}`);
  }
  if (conn.mcp) {
    const t = await api('POST', `/workspaces/${acme.id}/connections/${conn.mcp}/test`, { token: A.token });
    note(`MCP demo server test: ${t.body?.status || t.status}${t.body?.detail ? ` (${t.body.detail})` : ''}`);
  }

  // ---------------------------------------------------------------- knowledge base
  for (const doc of [
    { title: 'Refund policy', text: 'Refunds for failed payments over $100 need a second pair of eyes from the payments team. Customers on the gold tier are refunded automatically once the card is updated. Refunds are issued to the original payment method within 5 business days.' },
    { title: 'Payment failure playbook', text: 'When a card is declined, Stripe retries automatically on days 1, 3 and 7. Insufficient funds usually resolves on retry. Expired cards need the customer to update their details; send the billing portal link. Three failures in a month means contacting the customer before any refund.' },
  ]) {
    const r = await api('POST', '/knowledge', { ...A, body: doc });
    if (!r.ok) skip(`knowledge doc "${doc.title}"`, `${r.status}`);
  }

  // ---------------------------------------------------------------- workflows
  const graphIds = { ...conn, bob: ids.bob };
  const newWorkflow = (who, name) => must(`create ${name}`, api('POST', '/workflows', { ...who, body: { name } }));
  const save = (who, id, graph, name) => must(`save ${name || id}`, api('PUT', `/workflows/${id}`, { ...who, body: { ...graph, ...(name && { name }) } }));
  const publish = async (who, id, message) => {
    const r = await api('POST', `/workflows/${id}/publish`, { ...who, body: { message, acknowledgeWarnings: true } });
    if (!r.ok) skip(`publish "${message}"`, `${r.status} ${JSON.stringify(r.body?.errors || r.body?.error || r.body)}`);
    return r.ok;
  };

  const triage = await newWorkflow(A, 'Payment triage');
  for (const [v, message] of [[1, 'First version: route failed payments by amount'], [2, 'Add the triage agent and a refund approval'], [3, 'Open a GitHub issue on approval; raise the threshold to $100']]) {
    await save(A, triage._id, paymentTriage(v, graphIds));
    await publish(A, triage._id, message);
  }
  await must('subscribe triage to stripe.payment_failed', api('PUT', `/workflows/${triage._id}/event-trigger`, { ...A, body: { eventName: 'stripe.payment_failed', enabled: true } }));

  const report = await newWorkflow(A, 'Daily ops report');
  await save(A, report._id, {
    nodes: [
      N('s', 'start', 0, 0, { label: 'Weekdays 09:00' }),
      tool('q', 220, 0, 'Search yesterday\'s failures', 'builtin', 'fake-search', { query: 'failed payments yesterday', limit: 3 }),
      tool('kb', 440, 0, 'Look up the playbook', 'knowledge', 'search', { query: 'card declined retry' }),
      tool('post', 660, 0, 'Post to #ops', 'slack', 'post_message', { channel: '#ops', text: 'Daily payments report is ready.' }, conn.slack || null),
      N('e', 'end', 880, 0),
    ],
    edges: [E('s', 'q'), E('q', 'kb'), E('kb', 'post'), E('post', 'e')],
  });
  await publish(A, report._id, 'Daily report');
  await api('PUT', `/workflows/${report._id}/schedule`, { ...A, body: { cronExpression: '0 9 * * 1-5', enabled: true } });

  const sync = await newWorkflow(A, 'Order sync (error branch)');
  await save(A, sync._id, {
    nodes: [
      N('s', 'start', 0, 100),
      tool('get', 220, 100, 'Fetch new orders', 'http', 'request', { url: 'https://api.example.com/orders?status=new', method: 'GET' }, 'sandbox'),
      tool('ins', 440, 0, 'Store orders', 'database', 'insert', { collection: 'orders', document: { synced: true } }),
      tool('warn', 440, 220, 'Warn #ops', 'slack', 'post_message', { channel: '#ops', text: 'Order sync failed - it will retry on the next run.' }, conn.slack || null),
      N('e', 'end', 660, 100),
    ],
    edges: [E('s', 'get'), E('get', 'ins'), E('get', 'warn', { sourceHandle: 'error' }), E('ins', 'e'), E('warn', 'e')],
  });
  await publish(A, sync._id, 'Sync with an error branch');

  const risk = await newWorkflow(A, 'Risk score (code)');
  await save(A, risk._id, {
    nodes: [
      N('s', 'start', 0, 100),
      N('code', 'code', 220, 100, { label: 'Score the payment', source: 'const amount = input?.amount ?? 4200;\nreturn { amount, risk: amount > 10000 ? "high" : "low" };' }),
      N('cond', 'condition', 440, 100, { label: 'High risk?', expression: 'output.risk === "high"' }),
      tool('alert', 660, 0, 'Alert #risk', 'slack', 'post_message', { channel: '#risk', text: 'High-risk payment flagged.' }, conn.slack || null),
      N('e', 'end', 880, 100),
    ],
    edges: [E('s', 'code'), E('code', 'cond'), E('cond', 'alert', { sourceHandle: 'true', label: 'yes' }), E('cond', 'e', { sourceHandle: 'false', label: 'no' }), E('alert', 'e')],
  });
  await publish(A, risk._id, 'Initial scoring rule');

  const builtIns = (await api('GET', '/templates', A)).body || [];
  const cloned = [];
  for (const t of builtIns.filter((x) => x.builtIn).slice(0, 2)) {
    const r = await api('POST', `/templates/${t.id || t._id}/use`, A);
    if (r.ok) {
      const id = r.body?._id || r.body?.id || r.body?.workflowId;
      cloned.push({ id, name: r.body?.name || t.name });
      await publish(A, id, 'From template');
    } else skip(`template "${t.name}"`, `${r.status}`);
  }

  // Globex: the loop that shows off the fair queue (spec/33).
  const body = await newWorkflow(G, 'Enrich one lead');
  await save(G, body._id, {
    nodes: [
      N('s', 'start', 0, 0),
      tool('hs', 220, 0, 'Create HubSpot contact', 'hubspot', 'create_contact', { email: '{{input.item.email}}', firstName: '{{input.item.name}}' }),
      tool('wx', 440, 0, 'Look up their city weather', 'builtin', 'fake-weather', { city: 'Springfield' }),
      N('e', 'end', 660, 0),
    ],
    edges: [E('s', 'hs'), E('hs', 'wx'), E('wx', 'e')],
  });
  await publish(G, body._id, 'Enrichment body');
  const bulk = await newWorkflow(G, 'Bulk enrich');
  await save(G, bulk._id, {
    nodes: [
      N('s', 'start', 0, 0),
      N('leads', 'code', 220, 0, { label: 'Load 30 leads', source: 'return { leads: Array.from({ length: 30 }, (_, i) => ({ name: `Lead ${i + 1}`, email: `lead${i + 1}@globex.test` })) };' }),
      N('lp', 'loop', 440, 0, { label: 'Enrich each lead', itemsPath: '{{input.leads}}', workflowId: body._id, concurrency: 5, maxItems: 30 }),
      N('e', 'end', 660, 0),
    ],
    edges: [E('s', 'leads'), E('leads', 'lp'), E('lp', 'e')],
  });
  await publish(G, bulk._id, 'Enrich 30 leads');

  // ---------------------------------------------------------------- API key
  const key = await api('POST', `/workspaces/${acme.id}/api-keys`, { token: A.token, body: { name: 'Demo integration', scopes: ['events:publish', 'runs:create', 'runs:read'] } });
  const apiKey = key.ok ? key.body : null;
  if (!apiKey) skip('API key', `${key.status}`);

  // ---------------------------------------------------------------- comment + mention
  const thread = await api('POST', `/workflows/${triage._id}/threads`, {
    token: auth.bob.token, ws: acme.id,
    body: { anchor: { type: 'node', nodeId: 'ap' }, body: `{{@${ids.alice}}} should refunds over $100 always need your sign-off, or can I approve them on my own?` },
  });
  if (thread.ok) note('Bob left a comment on the approval node mentioning Alice'); else skip('comment thread', `${thread.status} ${JSON.stringify(thread.body)}`);

  // ---------------------------------------------------------------- history
  const versionsOf = async (workflowId) => WorkflowVersion.find({ workflowId }).sort({ version: 1 }).lean();
  const people = { alice: new mongoose.Types.ObjectId(ids.alice), bob: new mongoose.Types.ObjectId(ids.bob) };
  let backfilled = 0;
  const plans = [
    { wf: triage, ws: acme.id, perDay: [3, 7], triggers: ['event', 'event', 'event', 'api', 'manual'], inputFor: stripeInput },
    { wf: report, ws: acme.id, perDay: [1, 1], triggers: ['schedule'], inputFor: () => null },
    { wf: sync, ws: acme.id, perDay: [1, 4], triggers: ['webhook', 'manual', 'api'], inputFor: () => ({ source: 'shop', batch: between(1, 400) }) },
    { wf: risk, ws: acme.id, perDay: [0, 2], triggers: ['manual', 'api'], inputFor: () => ({ amount: pick([4200, 15000, 900, 22000]) }) },
    ...cloned.map((c) => ({ wf: { _id: c.id }, ws: acme.id, perDay: [0, 2], triggers: ['manual'], inputFor: () => ({}) })),
    { wf: bulk, ws: globex.id, perDay: [0, 2], triggers: ['manual'], inputFor: () => ({}) },
  ];
  for (const p of plans) {
    const versions = await versionsOf(p.wf._id);
    if (!versions.length) { skip(`history for ${p.wf.name || p.wf._id}`, 'not published'); continue; }
    backfilled += await backfill({
      workspaceId: new mongoose.Types.ObjectId(p.ws), workflow: p.wf, versions, perDay: p.perDay, triggers: p.triggers,
      people, apiKeyId: apiKey?.apiKey?.id ? new mongoose.Types.ObjectId(apiKey.apiKey.id) : null, inputFor: p.inputFor,
    });
  }
  note(`backfilled ${backfilled} runs over ${HISTORY_DAYS} days, with matching usage counters`);

  // ---------------------------------------------------------------- a real waiting approval
  // Fired through the real trigger path, so the run parks exactly as it would
  // in the demo; the server resumes it from MongoDB when Bob decides (spec/32).
  const fired = await api('POST', `/workspaces/${acme.id}/integrations/stripe/triggers/payment_failed/test`, { token: A.token, body: {} });
  const liveRunId = fired.body?.triggered?.[0];
  let waiting = null;
  if (liveRunId) {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const run = await Run.findById(liveRunId).select('status').lean();
      if (run && run.status !== 'pending' && run.status !== 'running') { waiting = run.status; break; }
      await new Promise((r) => setTimeout(r, 300));
    }
    note(waiting === 'waiting'
      ? 'a live Payment triage run is waiting for Bob\'s approval'
      : `the live Payment triage run ended as "${waiting || 'still running'}" instead of waiting (the mock agent is occasionally flaky - re-run the seed)`);
  } else {
    skip('live approval run', `${fired.status} ${JSON.stringify(fired.body)}`);
  }

  // ---------------------------------------------------------------- done
  await hub.flushAll?.();
  await flushUsage();
  await mcpPool.closeAll();
  stopRssPollers();
  await new Promise((resolve) => server.close(resolve));

  const origin = env.clientOrigin.replace(/\/+$/, '');
  console.log('\nDemo ready. Sign in with password "demo-password":');
  console.log(`  alice   ${PEOPLE.alice.email.padEnd(20)} owner of Acme       ${origin}/w/${acme.slug}/dashboard`);
  console.log(`  bob     ${PEOPLE.bob.email.padEnd(20)} editor in Acme      ${origin}/w/${acme.slug}/approvals`);
  console.log(`  victor  ${PEOPLE.victor.email.padEnd(20)} viewer in Acme`);
  console.log(`  carol   ${PEOPLE.carol.email.padEnd(20)} owner of Globex     ${origin}/w/${globex.slug}/dashboard`);
  console.log(`  pending invite: ${PENDING_INVITE} (see /outbox after signing up with that address)`);
  if (apiKey?.key) {
    console.log(`\nAcme API key (shown once): ${apiKey.key}`);
    console.log(`  curl -X POST ${env.publicBaseUrl}/api/w/${acme.slug}/events/stripe.payment_failed \\`);
    console.log(`    -H "Authorization: Bearer ${apiKey.key}" -H "Content-Type: application/json" -d '{"data":{"amount":12900,"customer":"cus_demo","paymentId":"pi_demo"}}'`);
  }
  console.log('\nRestart a running dev server to pick up the new schedule (cron jobs are registered at boot).');
  await mongoose.disconnect();
}

main().then(() => process.exit(0)).catch(async (err) => {
  console.error('\nseed:demo failed:', err.message);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
