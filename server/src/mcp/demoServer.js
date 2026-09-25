/**
 * The bundled demo MCP server (spec/37 §7): a small stdio server built on the
 * same SDK, on the allowlist by default and marked `sandboxSafe`.
 *
 *   node src/mcp/demoServer.js      (spawned by McpPool - never by a tenant)
 *
 * It only ever touches sandbox data, through spec/27's SandboxRecord store
 * under the integration id `agentflow-demo`.
 *
 * Which workspace? A stdio process has no request context, so the pool spawns
 * ONE process per connection and passes the connection's workspace as
 * AGENTFLOW_WORKSPACE_ID. A hidden `workspaceId` tool argument was rejected: it
 * pollutes schemas and a model could put another tenant's id in it. The run
 * that caused a write rides along in the request's `_meta['agentflow/runId']`.
 *
 * Deliberately imports nothing that reads config/env.js: the child's env holds
 * only MONGODB_URI, PATH and the workspace id - no JWT_SECRET, no vault key.
 */
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createSandboxStore } from '../integrations/sandboxStore.js';

const WORKSPACE_ID = process.env.AGENTFLOW_WORKSPACE_ID;
const INTEGRATION = 'agentflow-demo';

// Deterministic "random": the same id always seeds the same fake record, so a
// cached read and a fresh one agree (these tools are readOnlyHint).
function seeded(key) {
  const hash = crypto.createHash('sha256').update(String(key)).digest();
  let i = 0;
  return (n) => hash[i++ % hash.length] % n;
}

const FIRST = ['Ada', 'Grace', 'Linus', 'Margaret', 'Alan', 'Katherine', 'Dennis', 'Barbara'];
const LAST = ['Lovelace', 'Hopper', 'Torvalds', 'Hamilton', 'Turing', 'Johnson', 'Ritchie', 'Liskov'];
const TIERS = ['bronze', 'silver', 'gold'];
const PRODUCTS = [['Widget', 1200], ['Gadget', 4500], ['Sprocket', 800], ['Gizmo', 15900]];

const KB = [
  { title: 'Resetting your password', body: 'Use the "Forgot password" link on the sign-in page. Reset links expire after 30 minutes.' },
  { title: 'Refund policy', body: 'Refunds are available within 30 days of purchase. Gold tier customers get refunds without a receipt.' },
  { title: 'Shipping times', body: 'Standard shipping takes 3-5 business days. Express shipping arrives next business day.' },
  { title: 'Failed payments', body: 'A failed payment is retried after 3 days. Update the card on file to retry immediately.' },
  { title: 'Upgrading your plan', body: 'Plans can be upgraded any time from the billing page; the price difference is prorated.' },
  { title: 'Cancelling an order', body: 'Orders can be cancelled until they ship. Shipped orders must be returned for a refund.' },
];

const TOOLS = [
  {
    name: 'lookup_customer',
    title: 'Look up customer',
    description: 'Find a customer by id or email and return their name, email, tier and signup date.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Customer id, e.g. "42"' },
        email: { type: 'string', format: 'email', description: 'Customer email address' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' },
        tier: { type: 'string', enum: TIERS }, since: { type: 'string' },
      },
      required: ['id', 'name', 'tier'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_order',
    title: 'Get order',
    description: 'Fetch an order by its id, with status, total and line items.',
    inputSchema: {
      type: 'object',
      properties: { orderId: { type: 'string', description: 'Order id, e.g. "1042"' } },
      required: ['orderId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'search_kb',
    title: 'Search knowledge base',
    description: 'Keyword search over the help-center knowledge base articles.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for' },
        limit: { type: 'integer', minimum: 1, maximum: 10, default: 3 },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_ticket',
    title: 'Create support ticket',
    description: 'Open a support ticket for a customer. This has a side effect: it creates a record.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'One-line summary' },
        body: { type: 'string', maxLength: 2000, description: 'Ticket body content' },
        priority: { type: 'string', enum: ['low', 'normal', 'high'], default: 'normal' },
        customerId: { type: 'string' },
      },
      required: ['subject'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];

function reply(structured, text) {
  return { structuredContent: structured, content: [{ type: 'text', text: text ?? JSON.stringify(structured) }] };
}

const refuse = (text) => ({ isError: true, content: [{ type: 'text', text }] });

const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);

async function lookupCustomer(store, { id, email }) {
  if (!id && !email) return refuse('Pass either "id" or "email"');
  const found = await store.findOne('customers', id ? { customerId: String(id) } : { email: String(email).toLowerCase() });
  if (found) {
    const { customerId, name, email: e, tier, since } = found;
    return reply({ id: customerId, name, email: e, tier, since }, `${name} (${tier})`);
  }
  // First ask seeds a deterministic fake customer for this workspace.
  const key = id ? `id:${id}` : `email:${email}`;
  const pick = seeded(key);
  const name = `${FIRST[pick(FIRST.length)]} ${LAST[pick(LAST.length)]}`;
  const customer = {
    customerId: id ? String(id) : String(1000 + pick(9000)),
    name,
    email: email ? String(email).toLowerCase() : `${name.toLowerCase().replace(' ', '.')}@example.test`,
    tier: TIERS[pick(TIERS.length)],
    since: `20${18 + pick(7)}-0${1 + pick(9)}-1${pick(9)}`,
  };
  await store.insert('customers', customer);
  return reply({ id: customer.customerId, name: customer.name, email: customer.email, tier: customer.tier, since: customer.since }, `${name} (${customer.tier})`);
}

async function getOrder(store, { orderId }) {
  if (!orderId) return refuse('"orderId" is required');
  // A way to exercise isError end to end: the tool ran and said no.
  if (/^missing/i.test(String(orderId))) return refuse(`Order ${orderId} not found`);
  const existing = await store.findOne('orders', { orderId: String(orderId) });
  if (existing) {
    const { orderId: oid, status, total, currency, items } = existing;
    return reply({ orderId: oid, status, total, currency, items });
  }
  const pick = seeded(`order:${orderId}`);
  const items = Array.from({ length: 1 + pick(3) }, () => {
    const [sku, price] = PRODUCTS[pick(PRODUCTS.length)];
    return { sku, qty: 1 + pick(3), unitPrice: price };
  });
  const order = {
    orderId: String(orderId),
    status: ['paid', 'shipped', 'delivered', 'refunded'][pick(4)],
    total: items.reduce((sum, i) => sum + i.qty * i.unitPrice, 0),
    currency: 'usd',
    items,
  };
  await store.insert('orders', order);
  return reply(order);
}

async function searchKb(store, { query, limit = 3 }) {
  await store.seedOnce('kb', 'kb', KB);
  const terms = words(query);
  const articles = await store.find('kb', {}, { limit: 200 });
  const scored = articles
    .map((a) => ({ a, score: terms.reduce((n, t) => n + words(`${a.title} ${a.body}`).filter((w) => w.startsWith(t)).length, 0) }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || x.a.title.localeCompare(y.a.title))
    .slice(0, Math.max(1, Math.min(10, Number(limit) || 3)));
  const results = scored.map(({ a, score }) => ({ title: a.title, snippet: a.body, score }));
  return reply({ query, results }, results.length ? results.map((r) => `${r.title}: ${r.snippet}`).join('\n\n') : 'No matching articles.');
}

async function createTicket(store, { subject, body = '', priority = 'normal', customerId = null }) {
  if (!subject) return refuse('"subject" is required');
  const n = await store.nextNumber('ticket', { after: 100 });
  const ticketId = `TCK-${n}`;
  await store.insert('tickets', { ticketId, subject, body, priority, customerId, status: 'open' });
  return reply({ ticketId, url: `https://support.example.test/tickets/${ticketId}`, status: 'open' }, `Opened ${ticketId}: ${subject}`);
}

const HANDLERS = { lookup_customer: lookupCustomer, get_order: getOrder, search_kb: searchKb, create_ticket: createTicket };

async function main() {
  if (!WORKSPACE_ID || !mongoose.isValidObjectId(WORKSPACE_ID)) {
    console.error('[demo-mcp] AGENTFLOW_WORKSPACE_ID is missing - spawned outside AgentFlow?');
    process.exit(2);
  }
  await mongoose.connect(process.env.MONGODB_URI);

  const server = new Server({ name: 'agentflow-demo', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {}, _meta } = request.params;
    const handler = HANDLERS[name];
    if (!handler) return refuse(`Unknown tool: ${name}`);
    const runId = _meta?.['agentflow/runId'] || null;
    const store = createSandboxStore({ workspaceId: WORKSPACE_ID, integration: INTEGRATION, runId });
    try {
      return await handler(store, args);
    } catch (err) {
      return refuse(String(err?.message || err));
    }
  });

  await server.connect(new StdioServerTransport());
  const shutdown = async () => {
    await mongoose.disconnect().catch(() => {});
    process.exit(0);
  };
  process.stdin.on('close', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[demo-mcp] failed:', err);
  process.exit(1);
});
