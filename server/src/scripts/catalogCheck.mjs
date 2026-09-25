/**
 * Catalogue check for spec/27 part 1 — the sandbox store and the integration
 * manifests — as a runnable script:
 *
 *   npm run check:catalog
 *
 * Needs no server: it drives IntegrationRegistry and the sandbox store directly
 * against a throwaway database (your MONGODB_URI with a `-catalogcheck` suffix,
 * dropped on the way out). INTEGRATIONS_LIVE is forced off, so every action
 * runs its sandbox implementation; live adapters are exercised offline with a
 * stub `http` that records what would have gone over the wire.
 *
 * RSS, Knowledge Base, AI presets and inbound webhooks belong to spec/27 part 2
 * and are only shape-validated here.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.env.INTEGRATIONS_LIVE = 'false';

const mongoose = (await import('mongoose')).default;
const { env } = await import('../config/env.js');
const { INTEGRATIONS } = await import('../integrations/manifests/index.js');
const { IntegrationRegistry } = await import('../integrations/IntegrationRegistry.js');
const { createSandboxStore, clearSeedCache } = await import('../integrations/sandboxStore.js');
const { migrateSandboxRecords } = await import('./migrateSandboxRecords.js');
const { githubApiUrl } = await import('../integrations/manifests/github.js');
const { toolCache } = await import('../cache/TTLCache.js');
const SandboxRecord = (await import('../models/SandboxRecord.js')).default;
const OutboxMessage = (await import('../models/OutboxMessage.js')).default;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECK_DB_URI = `${env.mongodbUri.replace(/\/+$/, '')}-catalogcheck`;

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? ` — ${d}` : ''}`); ok ? pass++ : fail++; };
const brief = (v, n = 200) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? `${s.slice(0, n)}…` : s; };
const newWs = () => new mongoose.Types.ObjectId().toString();

/** One action through the real registry path (normalise, params, mode, cache, redaction). */
async function run(ws, integration, action, params = {}, { input = null } = {}) {
  return IntegrationRegistry.run({
    config: { integration, action, connectionId: null, params, mockOverrides: { failureRate: 0, latencyMs: [0, 1] } },
    input,
    context: { workspaceId: ws, runId: null, workflowId: null },
  });
}
async function runErr(...args) {
  try {
    await run(...args);
    return null;
  } catch (err) {
    return err;
  }
}

/** Stub for ctx.http: records requests, answers with a canned response. */
function stubHttp(respond = () => ({ status: 200, body: {} })) {
  const calls = [];
  const http = async (options) => {
    calls.push(options);
    const r = respond(options) || {};
    const status = r.status ?? 200;
    return { status, ok: status >= 200 && status < 300, url: options.url, headers: r.headers || {}, body: r.body ?? {}, text: '', truncated: false, durationMs: 1 };
  };
  return { http, calls };
}
async function runLive(integration, action, params, { connection, input = null, respond } = {}) {
  const manifest = IntegrationRegistry.get(integration);
  const def = manifest.actions.find((a) => a.id === action);
  const { http, calls } = stubHttp(respond);
  const logs = [];
  try {
    const output = await def.live({ params, input, connection, http, logs, workspaceId: newWs(), sandbox: null });
    return { output, calls, error: null };
  } catch (error) {
    return { output: null, calls, error };
  }
}

await mongoose.connect(CHECK_DB_URI);
await mongoose.connection.dropDatabase();
clearSeedCache();
console.log(`catalog check · db=${CHECK_DB_URI.split('/').pop()} · INTEGRATIONS_LIVE=false\n`);

// ------------------------------------------------------------------ A: manifests
console.log('A. every manifest validates');
const EXPECTED = ['slack', 'discord', 'teams', 'email', 'twilio', 'github', 'jira', 'linear', 'sheets', 'notion', 'airtable',
  'database', 'stripe', 'hubspot', 'http', 'webhook', 'rss', 'ai', 'knowledge', 'builtin'];
{
  const ids = INTEGRATIONS.map((m) => m.id);
  check(`all ${EXPECTED.length} catalogue integrations are registered`, EXPECTED.every((id) => ids.includes(id)), EXPECTED.filter((id) => !ids.includes(id)).join(', '));
  check('integration ids are unique', new Set(ids).size === ids.length);
  const problems = [];
  for (const m of INTEGRATIONS) {
    if (!m.name || !m.category || !m.auth?.type) problems.push(`${m.id}: name/category/auth`);
    // MCP's actions are discovered per connection (spec/37), never static.
    if (!m.actions?.length && typeof m.dynamicActions !== 'function') problems.push(`${m.id}: no actions`);
    for (const a of m.actions || []) {
      if (!Array.isArray(a.configSchema)) problems.push(`${m.id}.${a.id}: configSchema`);
      if (typeof a.sandbox !== 'function') problems.push(`${m.id}.${a.id}: sandbox`);
      if (!a.outputSample || typeof a.outputSample !== 'object') problems.push(`${m.id}.${a.id}: outputSample`);
      if (a.sideEffect && a.cacheable) problems.push(`${m.id}.${a.id}: side effect marked cacheable`);
    }
    for (const t of m.triggers || []) if (!t.samplePayload) problems.push(`${m.id}.${t.id}: samplePayload`);
  }
  check('every action has configSchema, sandbox and outputSample; every trigger a samplePayload', problems.length === 0, problems.join('; '));
  const liveSet = INTEGRATIONS.filter((m) => m.actions.some((a) => typeof a.live === 'function')).map((m) => m.id).sort();
  const expectLive = ['discord', 'github', 'http', 'rss', 'slack', 'webhook'];
  check('exactly the six spec/27 integrations have live adapters', JSON.stringify(liveSet) === JSON.stringify(expectLive), liveSet.join(', '));
  const inboundIds = INTEGRATIONS.filter((m) => m.inbound).map((m) => m.id);
  const withTriggers = INTEGRATIONS.filter((m) => (m.triggers || []).length && m.id !== 'rss').map((m) => m.id);
  check('every integration with (non-poll) triggers accepts inbound deliveries', withTriggers.every((id) => inboundIds.includes(id)), withTriggers.filter((id) => !inboundIds.includes(id)).join(', '));
  const catalogue = IntegrationRegistry.list();
  check('client catalogue carries no functions', !JSON.stringify(catalogue, (k, v) => (typeof v === 'function' ? '__fn__' : v)).includes('__fn__'));
}

// ------------------------------------------------------------------ B: every action runs
console.log('\nB. every sandbox action runs and returns its outputSample shape');
const PARAMS = {
  slack: { post_message: { channel: '#alerts', text: 'hello' }, post_to_thread: { channel: '#alerts', threadTs: '1727000000.000100', text: 'reply' } },
  discord: { send_message: { content: 'Deploy done' }, send_embed: { title: 'Deploy', description: 'v1.2.3' } },
  teams: { post_message: { title: 'Build', text: 'green' } },
  email: { send: { to: 'someone@catalog.test', subject: 'Hi', body: 'Body' } },
  twilio: { send_sms: { to: '+14155550123', body: 'Hi' } },
  github: { create_issue: { repo: 'acme/web', title: 'From check' }, comment: { repo: 'acme/web', number: 1, body: 'noted' }, list_issues: { repo: 'acme/web' }, get_repo: { repo: 'acme/web' } },
  jira: { create_ticket: { project: 'WEB', summary: 'From check', type: 'Bug' }, transition_ticket: { key: 'WEB-1', status: 'Done' } },
  linear: { create_issue: { team: 'ENG', title: 'From check', priority: '2' } },
  sheets: { append_row: { spreadsheet: 'Sales', values: '["2026-09-25", "Acme", 120, "Paid"]' }, read_rows: { spreadsheet: 'Sales' }, update_row: { spreadsheet: 'Sales', row: 2, values: '["2026-09-01", "Northwind", 1300, "Paid"]' } },
  notion: { create_page: { database: 'Projects', title: 'From check', properties: '{"Status":"Done"}' }, query_database: { database: 'Projects' } },
  airtable: { create_record: { base: 'CRM', table: 'Accounts', fields: '{"Name":"Acme"}' }, list_records: { base: 'CRM', table: 'Accounts' } },
  database: { insert: { collection: 'orders', document: '{"status":"open"}' }, find: { collection: 'orders' }, update: null },
  stripe: { create_customer: { email: 'jane@example.com', name: 'Jane' }, create_invoice: null, refund: null },
  hubspot: { create_contact: { email: `c${Date.now()}@example.com`, firstName: 'C' }, update_deal_stage: { deal: '9001', stage: 'closedwon' } },
  http: { request: { url: 'https://api.example.com/things', method: 'GET' } },
  webhook: { post: { url: 'https://example.com/hook', payload: '{"a":1}' } },
  builtin: { 'fake-weather': { city: 'Oslo' }, calculator: { expression: '2+2' }, 'fake-search': { query: 'agents' } },
};
{
  const ws = newWs();
  const store = (integration) => createSandboxStore({ workspaceId: ws, integration });
  const shapeProblems = [];
  const failures = [];
  const ran = [];
  for (const [integration, actions] of Object.entries(PARAMS)) {
    const manifest = IntegrationRegistry.get(integration);
    for (const action of manifest.actions) {
      let params = actions[action.id];
      // Params that depend on an earlier action's output in this workspace.
      if (integration === 'database' && action.id === 'update') {
        const [first] = await store('database').find('orders', {}, { limit: 1 });
        params = { collection: 'orders', id: first?.recordId, patch: '{"status":"closed"}' };
      }
      if (integration === 'stripe' && action.id === 'create_invoice') {
        const [customer] = await store('stripe').find('customers', { email: 'jane@example.com' });
        params = { customer: customer?.id, amount: 4900 };
      }
      if (integration === 'stripe' && action.id === 'refund') {
        const [payment] = await store('stripe').find('payments', { status: 'succeeded' });
        params = { payment: payment?.id };
      }
      if (params === undefined) {
        failures.push(`${integration}.${action.id}: no test params`);
        continue;
      }
      try {
        const result = await run(ws, integration, action.id, params);
        ran.push(`${integration}.${action.id}`);
        const missing = Object.keys(action.outputSample).filter((k) => !(k in (result.output || {})));
        if (missing.length) shapeProblems.push(`${integration}.${action.id} missing ${missing.join(',')}`);
        if (result.mode !== 'sandbox') shapeProblems.push(`${integration}.${action.id} ran ${result.mode}`);
      } catch (err) {
        failures.push(`${integration}.${action.id}: ${err.message}`);
      }
    }
  }
  const total = Object.keys(PARAMS).reduce((n, id) => n + IntegrationRegistry.get(id).actions.length, 0);
  check(`all ${total} sandbox actions ran without error`, failures.length === 0 && ran.length === total, failures.join(' | '));
  check('every output carries its outputSample keys and ran in sandbox mode', shapeProblems.length === 0, shapeProblems.join(' | '));
}

// ------------------------------------------------------------------ C: statefulness
console.log('\nC. stateful sandboxes: writes are readable, in this workspace only');
{
  const A = newWs(), B = newWs();
  toolCache.clear();

  // GitHub: seeded fixtures, numbering, create → list / get_repo, comment count.
  const fresh = await run(A, 'github', 'list_issues', { repo: 'acme/web' });
  check('fresh workspace: first github.list_issues returns the 3 seeded fixtures', fresh.output.count === 3 && fresh.output.issues.every((i) => i.state === 'open'), brief(fresh.output.issues.map((i) => i.number)));
  const created = await run(A, 'github', 'create_issue', { repo: 'acme/web', title: 'Refund stuck for order 1042', labels: 'bug, refunds' });
  check('github.create_issue numbers after the fixtures (#4) with a real-looking URL', created.output.number === 4 && created.output.url === 'https://github.com/acme/web/issues/4', brief(created.output));
  const second = await run(A, 'github', 'create_issue', { repo: 'acme/web', title: 'Second' });
  check('the next issue is #5', second.output.number === 5);
  const listed = await run(A, 'github', 'list_issues', { repo: 'acme/web' }, { input: { after: 'create' } });
  check('github.list_issues includes the new issues', listed.output.issues.some((i) => i.number === 4 && i.labels.includes('refunds')) && listed.output.count === 5, `count=${listed.output.count}`);
  const repo = await run(A, 'github', 'get_repo', { repo: 'acme/web' });
  check('github.get_repo counts the open issues', repo.output.openIssues === 5, `openIssues=${repo.output.openIssues}`);
  await run(A, 'github', 'comment', { repo: 'acme/web', number: 4, body: 'on it' });
  const afterComment = await run(A, 'github', 'list_issues', { repo: 'acme/web' }, { input: { after: 'comment' } });
  check('github.comment increments the issue\'s comment count', afterComment.output.issues.find((i) => i.number === 4)?.comments === 1);
  const missingIssue = await runErr(A, 'github', 'comment', { repo: 'acme/web', number: 99, body: 'x' });
  check('commenting on a missing issue fails permanently', missingIssue?.permanent === true, missingIssue?.message);
  const otherRepo = await run(A, 'github', 'list_issues', { repo: 'acme/api' });
  check('another repo gets its own fixtures, numbered from #1', otherRepo.output.count === 3 && otherRepo.output.issues.some((i) => i.number === 1));
  const inB = await run(B, 'github', 'list_issues', { repo: 'acme/web' });
  check('workspace B never sees workspace A\'s issues', inB.output.count === 3 && !inB.output.issues.some((i) => i.title === 'Refund stuck for order 1042'));

  // Sheets
  const appended = await run(A, 'sheets', 'append_row', { spreadsheet: 'Leads', values: '["2026-09-25", "Globex", 300, "New"]' });
  check('sheets.append_row lands on row 7 (header + 5 fixture rows)', appended.output.row === 7, `row=${appended.output.row}`);
  const read = await run(A, 'sheets', 'read_rows', { spreadsheet: 'Leads' });
  check('sheets.read_rows includes the appended row, in row order with the header', read.output.header[0] === 'Date' && read.output.rows.at(-1)?.values[1] === 'Globex' && read.output.rows[0].row === 2, brief(read.output.rows.at(-1)));
  await run(A, 'sheets', 'update_row', { spreadsheet: 'Leads', row: 7, values: '["2026-09-25", "Globex", 300, "Won"]' });
  const reread = await run(A, 'sheets', 'read_rows', { spreadsheet: 'Leads' }, { input: { after: 'update' } });
  check('sheets.update_row changes the row', reread.output.rows.find((r) => r.row === 7)?.values[3] === 'Won');
  const badRow = await runErr(A, 'sheets', 'update_row', { spreadsheet: 'Leads', row: 500, values: '[1]' });
  check('updating an empty row fails permanently', badRow?.permanent === true, badRow?.message);
  const readB = await run(B, 'sheets', 'read_rows', { spreadsheet: 'Leads' });
  check('workspace B\'s sheet has only the fixtures', readB.output.count === 5);

  // Stripe: invoice references a real customer; refunds respect the balance.
  const customer = await run(A, 'stripe', 'create_customer', { email: 'ap@globex.test', name: 'Globex' });
  check('stripe.create_customer returns a cus_ id', /^cus_[A-Za-z0-9]{14}$/.test(customer.output.id), customer.output.id);
  const invoice = await run(A, 'stripe', 'create_invoice', { customer: customer.output.id, amount: 12900, currency: 'USD' });
  check('stripe.create_invoice references that customer (in_ id, open)', invoice.output.customer === customer.output.id && /^in_/.test(invoice.output.id) && invoice.output.status === 'open' && invoice.output.currency === 'usd', brief(invoice.output));
  const ghost = await runErr(A, 'stripe', 'create_invoice', { customer: 'cus_doesnotexist00', amount: 100 });
  check('an invoice for an unknown customer fails permanently', ghost?.permanent === true && /No such customer/.test(ghost.message), ghost?.message);
  const crossTenant = await runErr(B, 'stripe', 'create_invoice', { customer: customer.output.id, amount: 100 });
  check('workspace B can\'t invoice workspace A\'s customer', crossTenant?.permanent === true);
  const [payment] = await createSandboxStore({ workspaceId: A, integration: 'stripe' }).find('payments', { status: 'succeeded' });
  const partial = await run(A, 'stripe', 'refund', { payment: payment.id, amount: 1000 });
  check('stripe.refund (partial) returns a re_ id', /^re_/.test(partial.output.id) && partial.output.amount === 1000);
  const tooMuch = await runErr(A, 'stripe', 'refund', { payment: payment.id, amount: payment.amount });
  check('refunding more than the remaining balance fails permanently', tooMuch?.permanent === true, tooMuch?.message);

  // Jira
  const ticket = await run(A, 'jira', 'create_ticket', { project: 'OPS', summary: 'Rotate keys', type: 'Task' });
  check('jira.create_ticket numbers after the fixtures (OPS-4)', ticket.output.key === 'OPS-4' && ticket.output.status === 'To Do', ticket.output.key);
  const moved = await run(A, 'jira', 'transition_ticket', { key: 'OPS-4', status: 'In Progress' });
  const movedAgain = await run(A, 'jira', 'transition_ticket', { key: 'ops-4', status: 'Done' });
  check('jira.transition_ticket changes status and reports where it came from', moved.output.from === 'To Do' && movedAgain.output.from === 'In Progress' && movedAgain.output.to === 'Done');
  const jiraB = await runErr(B, 'jira', 'transition_ticket', { key: 'OPS-4', status: 'Done' });
  check('workspace B has no OPS-4', jiraB?.permanent === true);

  // Database: the sandbox store is the database.
  const ins = await run(A, 'database', 'insert', { collection: 'orders', document: '{"orderId":"1042","status":"open"}' });
  const found = await run(A, 'database', 'find', { collection: 'orders', filter: '{"orderId":"1042"}' });
  check('database.insert then find returns the document', found.output.count === 1 && found.output.records[0].status === 'open' && found.output.records[0].recordId === ins.output.id);
  await run(A, 'database', 'update', { collection: 'orders', id: ins.output.id, patch: '{"status":"refunded"}' });
  const updated = await run(A, 'database', 'find', { collection: 'orders', filter: '{"orderId":"1042"}' });
  check('database.update is visible to the next find', updated.output.records[0]?.status === 'refunded');
  const findB = await run(B, 'database', 'find', { collection: 'orders', filter: '{"orderId":"1042"}' });
  check('SandboxRecord isolation: workspace B finds nothing in the same collection', findB.output.count === 0);

  // Notion / Airtable / HubSpot / Linear
  await run(A, 'notion', 'create_page', { database: 'Roadmap', title: 'Ship v2', properties: '{"Status":"Shipping"}' });
  const pages = await run(A, 'notion', 'query_database', { database: 'Roadmap', filter: '{"Status":"Shipping"}' });
  check('notion.create_page then query_database (property filter) finds it', pages.output.count === 1 && pages.output.results[0].title === 'Ship v2');
  const allPages = await run(A, 'notion', 'query_database', { database: 'Roadmap' });
  check('notion databases are seeded (3 fixtures + 1)', allPages.output.count === 4, `count=${allPages.output.count}`);
  const rec = await run(A, 'airtable', 'create_record', { base: 'CRM', table: 'Leads', fields: '{"Name":"Umbrella"}' });
  const recs = await run(A, 'airtable', 'list_records', { base: 'CRM', table: 'Leads' });
  check('airtable.create_record then list_records includes it (rec… id)', /^rec[A-Za-z0-9]{14}$/.test(rec.output.id) && recs.output.records.some((r) => r.id === rec.output.id));
  await run(A, 'hubspot', 'create_contact', { email: 'Lead@Globex.test' });
  const dupe = await runErr(A, 'hubspot', 'create_contact', { email: 'lead@globex.test' });
  check('hubspot.create_contact is stateful (the same email twice fails)', dupe?.permanent === true, dupe?.message);
  const deal = await run(A, 'hubspot', 'update_deal_stage', { deal: '9002', stage: 'closedwon' });
  const dealAgain = await run(A, 'hubspot', 'update_deal_stage', { deal: '9002', stage: 'closedlost' });
  check('hubspot.update_deal_stage moves a seeded deal and remembers it', deal.output.from === 'qualifiedtobuy' && dealAgain.output.from === 'closedwon');
  const l1 = await run(A, 'linear', 'create_issue', { team: 'ENG', title: 'one' });
  const l2 = await run(A, 'linear', 'create_issue', { team: 'ENG', title: 'two' });
  check('linear.create_issue numbers consecutively (ENG-128, ENG-129)', l1.output.identifier === 'ENG-128' && l2.output.identifier === 'ENG-129', `${l1.output.identifier} ${l2.output.identifier}`);

  // Write-only integrations: the record is in the store (browsable), in A only.
  await run(A, 'slack', 'post_message', { channel: '#ops', text: 'refund issued' });
  await run(A, 'discord', 'send_message', { content: 'refund issued' });
  await run(A, 'teams', 'post_message', { text: 'refund issued' });
  await run(A, 'twilio', 'send_sms', { to: '+14155550199', body: 'refund issued' });
  await run(A, 'webhook', 'post', { url: 'https://example.com/hook', payload: '{"event":"refund"}' });
  await run(A, 'http', 'request', { url: 'https://api.example.com/refunds', method: 'POST', body: '{"id":1}' });
  const expectations = [['slack', 'slack.messages', 'text', 'refund issued'], ['discord', 'discord.messages', 'content', 'refund issued'], ['teams', 'teams.messages', 'text', 'refund issued'], ['twilio', 'twilio.messages', 'body', 'refund issued'], ['webhook', 'webhook.deliveries', 'url', 'https://example.com/hook'], ['http', 'http.requests', 'method', 'POST']];
  const missingWrites = [];
  for (const [integration, collectionName, field, value] of expectations) {
    const inA = await SandboxRecord.countDocuments({ workspaceId: A, integration, collectionName, [`doc.${field}`]: value });
    const inBCount = await SandboxRecord.countDocuments({ workspaceId: B, integration, collectionName });
    if (inA !== 1 || inBCount !== 0) missingWrites.push(`${collectionName} A=${inA} B=${inBCount}`);
  }
  check('write-only sandboxes record what they "sent" (slack, discord, teams, twilio, webhook, http)', missingWrites.length === 0, missingWrites.join(' | '));
  await run(A, 'email', 'send', { to: 'Refunds@Catalog.test', subject: 'Refund 1042', body: 'Done' });
  const mail = await OutboxMessage.findOne({ to: 'refunds@catalog.test', kind: 'smtp' }).lean();
  check('email.send delivers to the recipient\'s Outbox (kind smtp)', Boolean(mail) && mail.subject === 'Refund 1042');

  // Browsing + reset helpers used by the Sandbox data tab.
  const cols = await createSandboxStore({ workspaceId: A, integration: 'github' }).collections();
  check('collections() lists user-visible collections only (no _seeded/_counters)', cols.some((c) => c.name === 'issues') && !cols.some((c) => c.name.startsWith('_')), brief(cols));
  const removed = await createSandboxStore({ workspaceId: A, integration: 'github' }).reset();
  const afterReset = await run(A, 'github', 'list_issues', { repo: 'acme/web' }, { input: { after: 'reset' } });
  check('reset() clears the sandbox and fixtures re-seed on next touch', removed > 0 && afterReset.output.count === 3, `removed=${removed} count=${afterReset.output.count}`);
}

// ------------------------------------------------------------------ D: filters
console.log('\nD. equality-only filters: no operator injection');
{
  const ws = newWs();
  await run(ws, 'database', 'insert', { collection: 'users', document: '{"role":"admin","name":"root"}' });
  const dollar = await runErr(ws, 'database', 'find', { collection: 'users', filter: '{"$where":"1"}' });
  check('a $-prefixed filter key is rejected permanently', dollar?.permanent === true && /not allowed/.test(dollar.message), dollar?.message);
  const nested = await runErr(ws, 'database', 'find', { collection: 'users', filter: '{"role":{"$ne":null}}' });
  check('an operator hidden in a filter value is rejected permanently', nested?.permanent === true, nested?.message);
  const dotted = await runErr(ws, 'database', 'find', { collection: 'users', filter: '{"a.b":1}' });
  check('a dotted filter path is rejected permanently', dotted?.permanent === true);
  const patch = await runErr(ws, 'database', 'update', { collection: 'users', id: new mongoose.Types.ObjectId().toString(), patch: '{"$set":{"role":"x"}}' });
  check('a $-prefixed patch key is rejected permanently', patch?.permanent === true);
  const badJson = await runErr(ws, 'database', 'insert', { collection: 'users', document: '{not json' });
  check('malformed JSON fails permanently', badJson?.permanent === true);
  const noWs = await runErr(null, 'database', 'insert', { collection: 'users', document: '{}' });
  check('the sandbox store refuses to run without a workspace', noWs?.permanent === true, noWs?.message);
}

// ------------------------------------------------------------------ E: live adapters, offline
console.log('\nE. live adapters go through ctx.http only, to the right hosts');
{
  const scanDir = path.join(HERE, '..', 'integrations');
  const offenders = [];
  const files = [...fs.readdirSync(path.join(scanDir, 'manifests')).map((f) => path.join('manifests', f)), ...fs.readdirSync(scanDir).filter((f) => f.endsWith('.js'))];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(scanDir, rel), 'utf8');
    if (/from\s+['"](node:)?(https?|undici|axios|node-fetch)['"]|require\(['"](node:)?https?['"]\)|\bfetch\s*\(/.test(text)) offenders.push(rel);
  }
  check('no integration file imports http/https/undici or calls fetch (only ctx.http → safeRequest)', offenders.length === 0, offenders.join(', '));

  check('githubApiUrl keeps paths on api.github.com', githubApiUrl('/repos/acme/web/issues') === 'https://api.github.com/repos/acme/web/issues');
  let refused = 0;
  for (const bad of ['https://evil.test/repos', '//evil.test/x', 'http://api.github.com/user']) {
    try { githubApiUrl(bad); } catch (err) { if (err.permanent) refused += 1; }
  }
  check('githubApiUrl refuses other hosts, protocol-relative paths and plain http', refused === 3, `${refused}/3`);

  const gh = { id: 'c1', mode: 'live', credentials: { token: 'ghp_checktoken' }, config: {} };
  const escape = await runLive('github', 'create_issue', { repo: '../../evil', title: 'x' }, { connection: gh });
  check('github live rejects a repo that walks out of /repos/ before any request', escape.error?.permanent === true && escape.calls.length === 0, escape.error?.message);
  const ghOk = await runLive('github', 'create_issue', { repo: 'acme/web', title: 'Live', labels: '["bug"]' }, {
    connection: gh,
    respond: () => ({ status: 201, body: { number: 77, html_url: 'https://github.com/acme/web/issues/77', state: 'open', title: 'Live' } }),
  });
  const ghCall = ghOk.calls[0] || {};
  check('github live POSTs to api.github.com with the API version headers and bearer token', new URL(ghCall.url || 'http://x').host === 'api.github.com' && ghCall.method === 'POST' && ghCall.headers?.['X-GitHub-Api-Version'] === '2022-11-28' && ghCall.headers?.Authorization === 'Bearer ghp_checktoken' && ghOk.output?.number === 77, brief(ghCall));
  const limited = await runLive('github', 'list_issues', { repo: 'acme/web' }, {
    connection: gh,
    respond: () => ({ status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600) }, body: { message: 'API rate limit exceeded' } }),
  });
  check('github rate limit far in the future fails permanently with the reset time', limited.error?.permanent === true && /rate limited until/.test(limited.error.message), limited.error?.message);
  const soon = await runLive('github', 'get_repo', { repo: 'acme/web' }, { connection: gh, respond: () => ({ status: 429, headers: { 'retry-after': '2' } }) });
  check('github 429 with a short Retry-After is retryable with retryAfterMs', !soon.error?.permanent && soon.error?.retryAfterMs === 2000, `${soon.error?.message} ${soon.error?.retryAfterMs}`);

  const slackBad = await runLive('slack', 'post_message', { channel: '#x', text: 'y' }, { connection: { mode: 'live', credentials: { webhookUrl: 'https://evil.test/services/T/B/X' } } });
  check('slack live refuses a webhook URL off hooks.slack.com (no request made)', slackBad.error?.permanent === true && slackBad.calls.length === 0);
  const slackOk = await runLive('slack', 'post_message', { channel: '#x', text: 'y' }, { connection: { mode: 'live', credentials: { webhookUrl: 'https://hooks.slack.com/services/T0/B0/XYZ' } }, respond: () => ({ status: 200, body: 'ok' }) });
  check('slack live posts through ctx.http', slackOk.calls.length === 1 && slackOk.output?.posted === true);
  const discordBad = await runLive('discord', 'send_message', { content: 'x' }, { connection: { mode: 'live', credentials: { webhookUrl: 'https://discord.evil.test/api/webhooks/1/abc' } } });
  check('discord live refuses a non-Discord webhook host (no request made)', discordBad.error?.permanent === true && discordBad.calls.length === 0);
  const discordOk = await runLive('discord', 'send_embed', { title: 'T', color: 255 }, {
    connection: { mode: 'live', credentials: { webhookUrl: 'https://discord.com/api/webhooks/1/abc' } },
    respond: () => ({ status: 200, body: { id: '123', channel_id: '456' } }),
  });
  check('discord live adds ?wait=true and returns the created message id', /wait=true/.test(discordOk.calls[0]?.url || '') && discordOk.output?.id === '123' && discordOk.output?.channelId === '456');
  const discordGone = await runLive('discord', 'send_message', { content: 'x' }, { connection: { mode: 'live', credentials: { webhookUrl: 'https://discord.com/api/webhooks/1/abc' } }, respond: () => ({ status: 404, body: { message: 'Unknown Webhook' } }) });
  check('a revoked Discord webhook (404) fails permanently', discordGone.error?.permanent === true);

  const signed = await runLive('webhook', 'post', { url: 'https://example.com/hook', payload: { event: 'refund', id: 7 } }, { connection: { mode: 'live', credentials: { secret: 's3cret' } }, respond: () => ({ status: 202 }) });
  const sent = signed.calls[0] || {};
  const expectSig = `sha256=${crypto.createHmac('sha256', 's3cret').update(sent.body || '').digest('hex')}`;
  check('outbound webhook signs the exact bytes sent (X-AgentFlow-Signature)', sent.headers?.['X-AgentFlow-Signature'] === expectSig && sent.body === '{"event":"refund","id":7}', brief(sent.headers));
  const unsigned = await runLive('webhook', 'post', { url: 'https://example.com/hook' }, { connection: null, input: { from: 'input' }, respond: () => ({ status: 200 }) });
  check('without a secret the webhook is unsigned and defaults to the node input', !unsigned.calls[0]?.headers?.['X-AgentFlow-Signature'] && unsigned.calls[0]?.body === '{"from":"input"}');
  const postFail = await runLive('webhook', 'post', { url: 'https://example.com/hook', payload: {} }, { respond: () => ({ status: 503 }) });
  check('a POST webhook 503 is not retried (it may have been received)', postFail.error?.permanent === true && /not idempotent/.test(postFail.error.message), postFail.error?.message);
}

// ------------------------------------------------------------------ F: migration
console.log('\nF. MockRecord → SandboxRecord migration is idempotent');
{
  const db = mongoose.connection.db;
  const ws = new mongoose.Types.ObjectId();
  const legacy = new mongoose.Types.ObjectId(), adapter = new mongoose.Types.ObjectId(), orphan = new mongoose.Types.ObjectId();
  const runId = new mongoose.Types.ObjectId();
  const at = new Date('2026-08-01T10:00:00Z');
  await db.collection('mockrecords').insertMany([
    { _id: legacy, workspaceId: ws, runId, collectionName: 'orders', document: { orderId: 'L1', status: 'open' }, createdAt: at },
    { _id: adapter, workspaceId: ws, collectionName: 'slack.messages', document: { channel: '#ops', text: 'hi' }, createdAt: at },
    { _id: orphan, collectionName: 'orders', document: { lost: true }, createdAt: at },
  ]);
  const first = await migrateSandboxRecords({ log: () => {} });
  check('first run moves the two tenant records and skips the orphan', first.moved === 2 && first.skipped === 1, JSON.stringify(first));
  const movedLegacy = await db.collection('sandboxrecords').findOne({ _id: legacy });
  check('a phase-2 row becomes database.<name> with its document, run and timestamp', movedLegacy?.integration === 'database' && movedLegacy.collectionName === 'database.orders' && movedLegacy.doc?.orderId === 'L1' && String(movedLegacy.runId) === String(runId) && +movedLegacy.createdAt === +at);
  const movedAdapter = await db.collection('sandboxrecords').findOne({ _id: adapter });
  check('an already-namespaced row keeps its integration and collection', movedAdapter?.integration === 'slack' && movedAdapter.collectionName === 'slack.messages');
  check('moved rows are gone from mockrecords; the orphan stays visibly', (await db.collection('mockrecords').countDocuments({ _id: { $in: [legacy, adapter] } })) === 0 && (await db.collection('mockrecords').countDocuments({ _id: orphan })) === 1);
  const second = await migrateSandboxRecords({ log: () => {} });
  check('second run moves nothing', second.moved === 0 && (await db.collection('sandboxrecords').countDocuments({ _id: { $in: [legacy, adapter] } })) === 2);
  const viaAction = await run(ws.toString(), 'database', 'find', { collection: 'orders', filter: '{"orderId":"L1"}' });
  check('a migrated phase-2 record is readable through database.find', viaAction.output.count === 1);
  await db.collection('mockrecords').deleteMany({});
  const noCollection = await migrateSandboxRecords({ log: () => {} });
  check('with nothing left the migration is a no-op', noCollection.moved === 0);
}

await mongoose.connection.dropDatabase();
await mongoose.disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
