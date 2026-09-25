/**
 * MCP + agent tool use check for spec/37 - the acceptance criteria as a
 * runnable script.
 *
 *   npm run check:mcp          (BASE → a running server, INTEGRATIONS_LIVE=false)
 *
 * Two halves:
 * - In-process (engine, pool, providers) against a throwaway database - your
 *   MONGODB_URI with a `-mcpcheck` suffix, dropped on the way out - with live
 *   integrations ON, QUEUE_CONCURRENCY=2 (for the no-deadlock section) and a
 *   short MCP call timeout. Uses the bundled demo server over stdio and an
 *   in-process Streamable HTTP test server built with the same SDK.
 * - Over HTTP against BASE: the connection API rules, discovery endpoints and
 *   spec/37 §4's sandbox behaviour (the runner starts that server with
 *   INTEGRATIONS_LIVE=false).
 *
 * The single `AGENT_PROVIDER=anthropic` criterion needs a real key; here the
 * LLM tool-use loop runs against a stubbed Messages API client instead.
 */
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---- env for the in-process half: must be set before anything reads config/env.js
const ORIGINAL_DB = (process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/agent-orchestration').replace(/\/+$/, '');
const CHECK_DB = `${ORIGINAL_DB}-mcpcheck`;
process.env.MONGODB_URI = CHECK_DB; // the demo server child inherits this through ${MONGODB_URI}
process.env.INTEGRATIONS_LIVE = 'true';
process.env.QUEUE_CONCURRENCY = '2';
process.env.MCP_CALL_TIMEOUT_MS = '1500';
process.env.AGENT_PROVIDER = 'mock';
const B = process.env.BASE || 'http://localhost:4500/api';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sdk = (p) => pathToFileURL(path.join(SERVER_DIR, 'node_modules/@modelcontextprotocol/sdk/dist/esm', p)).href;

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Before any MCP use: importing the app must not load the SDK (spec/37 §1).
const { mcpPool, isSdkLoaded } = await import('../mcp/McpPool.js');
await import('../app.js');
const sdkLoadedAtBoot = isSdkLoaded();

const { default: mongoose } = await import('mongoose');
const { executeRun } = await import('../engine/executeRun.js');
const { default: Run } = await import('../models/Run.js');
const { default: Connection } = await import('../models/Connection.js');
const { default: SandboxRecord } = await import('../models/SandboxRecord.js');
const { toolCache } = await import('../cache/TTLCache.js');
const { queue } = await import('../queue/index.js');
const { setIo } = await import('../sockets/ioInstance.js');
const { IntegrationRegistry } = await import('../integrations/IntegrationRegistry.js');
const { __setAllowlistForTests, listAllowlist, buildSpawnEnv, getAllowlistEntry } = await import('../mcp/allowlist.js');
const { schemaToConfig } = await import('../mcp/schemaToConfig.js');
const { targetFingerprint } = await import('../mcp/tools.js');
const { validateAgentTools, MAX_STEPS } = await import('../engine/agentLoop.js');
const { LLMAgentProvider } = await import('../providers/LLMAgentProvider.js');
const { MockAgentProvider } = await import('../providers/MockAgentProvider.js');
const { __setAgentProviderForTests, llmRequestOptions } = await import('../config/agentProvider.js');
const { encrypt, connectionAad } = await import('../secrets/vault.js');

// Socket capture: every run-room emit lands here.
const emitted = [];
setIo({ to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) });

await mongoose.connect(CHECK_DB);
console.log(`mcp check · concurrency=${queue.concurrency} · base=${B}\n`);

// ------------------------------------------------------------------ helpers
const WS = new mongoose.Types.ObjectId(); // no Workspace doc: uncapped, like check:engine
const WS_B = new mongoose.Types.ObjectId();
const node = (id, type, config = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { config: { label: id, ...config } } });
const edge = (source, target, extra = {}) => ({ id: `e-${source}-${target}-${extra.label || ''}`, source, target, ...extra });
const linear = (...ns) => ns.slice(1).map((n, i) => edge(ns[i].id, n.id));

async function run(workflow, { input = null, workspaceId = WS } = {}) {
  const wf = { _id: new mongoose.Types.ObjectId(), workspaceId, ...workflow };
  const doc = await Run.create({ workflowId: wf._id, workspaceId, status: 'pending', input });
  const id = doc._id.toString();
  const finished = await executeRun(id, wf, { input });
  const byId = Object.fromEntries(finished.nodeResults.map((r) => [r.nodeId, r]));
  return { runDoc: finished, byId, id };
}

async function makeConnection({ workspaceId = WS, name = 'Demo Tools', config, credentials = null, mode = 'live' }) {
  const _id = new mongoose.Types.ObjectId();
  const doc = await Connection.create({
    _id, workspaceId, integration: 'mcp', name, mode, config,
    credentials: credentials ? encrypt(credentials, connectionAad(workspaceId, _id)) : null,
  });
  return doc._id.toString();
}
const resolved = (workspaceId, id) => IntegrationRegistry.resolveConnection(workspaceId, id, 'mcp');
const mcpTool = (id, connectionId, action, params = {}, over = {}) => node(id, 'tool', {
  integration: 'mcp', action, connectionId, params, mockOverrides: { maxAttempts: 3, ...over },
});

// ---------------------------------------------------------- test HTTP MCP server
const httpState = { requests: [], lastAuth: null, slowCalls: 0 };
const SECRET = 'Bearer sk-test-SECRET-9f8e7d';
const IMAGE_B64 = Buffer.alloc(1500, 7).toString('base64');

const { Server: McpServer } = await import(sdk('server/index.js'));
const { StreamableHTTPServerTransport } = await import(sdk('server/streamableHttp.js'));
const types = await import(sdk('types.js'));

function makeTestServer() {
  const server = new McpServer({ name: 'check-http', version: '0.9.0' }, { capabilities: { tools: {} } });
  const TOOLS = [
    { name: 'whoami', description: 'Report the auth header the server saw', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
    { name: 'echo_image', description: 'Return an image', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
    { name: 'fail', description: 'Always refuses', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
    { name: 'slow', description: 'Slow on its first call', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
    {
      name: 'structured', description: 'Returns an invoice total',
      inputSchema: { type: 'object', properties: { invoiceId: { type: 'string' } }, required: ['invoiceId'] },
      outputSchema: { type: 'object', properties: { total: { type: 'number' }, currency: { type: 'string' } }, required: ['total'] },
      annotations: { readOnlyHint: true },
    },
    { name: 'plain', description: 'No output schema', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } },
  ];
  server.setRequestHandler(types.ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(types.CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    if (name === 'whoami') return { content: [{ type: 'text', text: `auth=${httpState.lastAuth}` }] };
    if (name === 'echo_image') return { content: [{ type: 'image', data: IMAGE_B64, mimeType: 'image/png' }, { type: 'text', text: 'here it is' }] };
    if (name === 'fail') return { isError: true, content: [{ type: 'text', text: 'nope, refused' }] };
    if (name === 'slow') {
      httpState.slowCalls += 1;
      if (httpState.slowCalls === 1) await sleep(2500);
      return { content: [{ type: 'text', text: 'finally' }] };
    }
    if (name === 'structured') return { structuredContent: { total: 12.5, currency: 'usd', invoiceId: args.invoiceId }, content: [{ type: 'text', text: '12.5 usd' }] };
    return { content: [{ type: 'text', text: `plain ${args.q || ''}` }] };
  });
  return server;
}

const sessions = {};
const testServer = http.createServer(async (req, res) => {
  httpState.requests.push({ method: req.method, ua: req.headers['user-agent'] || '', auth: req.headers.authorization || null });
  httpState.lastAuth = req.headers.authorization || null;
  let body;
  if (req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = undefined; }
  }
  const sid = req.headers['mcp-session-id'];
  let transport = sid ? sessions[sid] : null;
  if (!transport) {
    if (req.method === 'POST' && types.isInitializeRequest(body)) {
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: (id) => { sessions[id] = transport; } });
      await makeTestServer().connect(transport);
    } else {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'no session' }));
      return;
    }
  }
  await transport.handleRequest(req, res, body);
});
await new Promise((r) => testServer.listen(0, '127.0.0.1', r));
const TEST_URL = `http://127.0.0.1:${testServer.address().port}/mcp`;

// =================================================================== A: lazy SDK, allowlist, spawn env
console.log('A. lazy SDK load, allowlist and the spawned environment');
{
  check('importing the app does not load @modelcontextprotocol/sdk', sdkLoadedAtBoot === false);
  const list = listAllowlist();
  check('allowlist lists the bundled demo server', list.some((e) => e.id === 'agentflow-demo'), JSON.stringify(list));
  check('public allowlist shape has no command/args/env', list.every((e) => !('command' in e) && !('args' in e) && !('env' in e)));
  check('demo entry is sandboxSafe + injectWorkspaceContext', getAllowlistEntry('agentflow-demo')?.sandboxSafe === true && getAllowlistEntry('agentflow-demo')?.injectWorkspaceContext === true);

  // An env-probe stdio server: reports its own environment keys.
  const probe = path.join(os.tmpdir(), `agentflow-mcp-probe-${process.pid}.mjs`);
  fs.writeFileSync(probe, `
    import { Server } from ${JSON.stringify(sdk('server/index.js'))};
    import { StdioServerTransport } from ${JSON.stringify(sdk('server/stdio.js'))};
    import { ListToolsRequestSchema, CallToolRequestSchema } from ${JSON.stringify(sdk('types.js'))};
    const s = new Server({ name: 'probe', version: '1' }, { capabilities: { tools: {} } });
    s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'env_keys', inputSchema: { type: 'object', properties: {} } }] }));
    s.setRequestHandler(CallToolRequestSchema, async () => ({ structuredContent: { keys: Object.keys(process.env), ws: process.env.AGENTFLOW_WORKSPACE_ID || null, foo: process.env.FOO || null }, content: [] }));
    await s.connect(new StdioServerTransport());
    process.stdin.on('close', () => process.exit(0));
  `);
  const realEntries = [getAllowlistEntry('agentflow-demo')];
  __setAllowlistForTests([...realEntries, { id: 'probe', name: 'Probe', command: process.execPath, args: [probe], env: { FOO: '${QUEUE_CONCURRENCY}-ok' }, injectWorkspaceContext: true }]);
  const probeConn = { id: String(new mongoose.Types.ObjectId()), name: 'Probe', mode: 'live', credentials: {}, config: { transport: 'stdio', allowlistId: 'probe' } };
  const r = await mcpPool.callTool(probeConn, WS, { name: 'env_keys', args: {} });
  // macOS injects __CF_USER_TEXT_ENCODING into every process it execs; it isn't
  // inherited from the server's environment.
  const keys = (r.structuredContent?.keys || []).filter((k) => k !== '__CF_USER_TEXT_ENCODING');
  check('SDK loads on first MCP use', isSdkLoaded() === true);
  check('spawned env holds only the entry env + PATH + workspace id', keys.every((k) => ['PATH', 'FOO', 'AGENTFLOW_WORKSPACE_ID'].includes(k)), keys.join(','));
  check('JWT_SECRET and SECRETS_MASTER_KEY are absent from the child', !keys.includes('JWT_SECRET') && !keys.includes('SECRETS_MASTER_KEY'));
  check('${VAR} placeholders resolve from the server env', r.structuredContent?.foo === '2-ok', r.structuredContent?.foo);
  check('AGENTFLOW_WORKSPACE_ID is the connection workspace', r.structuredContent?.ws === String(WS));
  check('buildSpawnEnv never copies the server env wholesale', !('JWT_SECRET' in buildSpawnEnv({ env: {} })) && !('MONGODB_URI' in buildSpawnEnv({ env: {} })));
  mcpPool.close(probeConn.id);
  __setAllowlistForTests(realEntries);
  fs.rmSync(probe, { force: true });

  const ghost = { id: String(new mongoose.Types.ObjectId()), name: 'Ghost', mode: 'live', credentials: {}, config: { transport: 'stdio', allowlistId: 'not-allowlisted' } };
  let err = null;
  try { await mcpPool.callTool(ghost, WS, { name: 'x', args: {} }); } catch (e) { err = e; }
  check('non-allowlisted stdio id fails permanently', err?.permanent === true && /no longer allowlisted/.test(err.message), err?.message);
  check('…and nothing was spawned for it', mcpPool.describe(ghost.id)?.pid == null);

  const shape = schemaToConfig({ type: 'object', properties: {
    title: { type: 'string' }, email: { type: 'string', format: 'email' }, body: { type: 'string', maxLength: 5000 },
    n: { type: 'integer', minimum: 1, maximum: 5 }, flag: { type: 'boolean' }, pri: { type: 'string', enum: ['a', 'b'] },
    meta: { type: 'object' }, list: { type: 'array', items: { type: 'string' } }, pick: { oneOf: [{ type: 'string' }] },
  }, required: ['title'] });
  const by = Object.fromEntries(shape.configSchema.map((f) => [f.key, f]));
  check('schema→form: string/text, required carried', by.title?.type === 'text' && by.title.required === true);
  check('schema→form: format becomes a placeholder hint', by.email?.placeholder === 'email');
  check('schema→form: long string → textarea', by.body?.type === 'textarea');
  check('schema→form: integer → number with min/max', by.n?.type === 'number' && by.n.min === 1 && by.n.max === 5);
  check('schema→form: boolean, enum → select', by.flag?.type === 'boolean' && by.pri?.type === 'select' && by.pri.options.length === 2);
  check('schema→form: object/array/oneOf → JSON editor for that property', ['meta', 'list', 'pick'].every((k) => by[k]?.type === 'json'));
  const wide = schemaToConfig({ type: 'object', properties: Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`p${i}`, { type: 'string' }])) });
  check('schema→form: > 25 properties → one JSON editor', wide.jsonEditor === true && wide.configSchema.length === 1);
}

// =================================================================== B: demo server over stdio as a tool node
console.log('\nB. MCP Tool node over stdio (bundled demo server)');
const DEMO = await makeConnection({ config: { transport: 'stdio', allowlistId: 'agentflow-demo' } });
const DEMO_B = await makeConnection({ workspaceId: WS_B, config: { transport: 'stdio', allowlistId: 'agentflow-demo' } });
{
  const t = await IntegrationRegistry.testConnection('mcp', { connection: await resolved(WS, DEMO), workspaceId: WS });
  check('test connection: initialize + tools/list', t.ok && /4 tools/.test(t.message), t.message);
  const snap = (await Connection.findById(DEMO).lean()).config.toolsSnapshot;
  check('tools snapshot saved on the connection', snap?.tools?.length === 4 && Boolean(snap.fetchedAt) && snap.serverInfo?.name === 'agentflow-demo');
  const actions = await IntegrationRegistry.actionsFor('mcp', { workspaceId: WS, connectionId: DEMO });
  const lookup = actions.find((a) => a.id === 'lookup_customer');
  check('tools become dynamic actions with generated forms', actions.length === 4 && lookup?.configSchema?.some((f) => f.key === 'email'));
  check('readOnlyHint → cacheable, otherwise side effect', lookup?.cacheable === true && actions.find((a) => a.id === 'create_ticket')?.sideEffect === true);

  toolCache.clear();
  const s = node('s', 'start');
  const e = node('e', 'end');
  const tn = mcpTool('t', DEMO, 'lookup_customer', { id: '{{input.customerId}}' });
  const r1 = await run({ nodes: [s, tn, e], edges: linear(s, tn, e) }, { input: { customerId: '42' } });
  check('MCP node runs a real tools/call', r1.runDoc.status === 'success' && r1.byId.t.output?.id === '42' && Boolean(r1.byId.t.output?.tier), JSON.stringify(r1.byId.t.output));
  check('node result records integration/action/mode', r1.byId.t.integration === 'mcp' && r1.byId.t.action === 'lookup_customer' && r1.byId.t.mode === 'live');
  const r2 = await run({ nodes: [s, tn, e], edges: linear(s, tn, e) }, { input: { customerId: '42' } });
  check('readOnlyHint tool: repeat call is a cache hit', r2.byId.t.cached === true);
  const tnOther = mcpTool('t', DEMO_B, 'lookup_customer', { id: '42' });
  const r3 = await run({ nodes: [s, tnOther, e], edges: linear(s, tnOther, e) }, { workspaceId: WS_B });
  check('no cache hit across workspaces/connections', r3.byId.t.cached !== true && r3.runDoc.status === 'success');

  const ticket = mcpTool('t', DEMO, 'create_ticket', { subject: 'Printer on fire', priority: 'high' });
  const k1 = await run({ nodes: [s, ticket, e], edges: linear(s, ticket, e) });
  const k2 = await run({ nodes: [s, ticket, e], edges: linear(s, ticket, e) });
  const tickets = await SandboxRecord.countDocuments({ workspaceId: WS, collectionName: 'agentflow-demo.tickets' });
  check('side-effecting tool is never cached (two tickets)', k1.byId.t.cached !== true && k2.byId.t.cached !== true && tickets === 2, `tickets=${tickets}`);
  const rec = await SandboxRecord.findOne({ workspaceId: WS, collectionName: 'agentflow-demo.tickets' }).lean();
  check("demo server attributes writes via _meta runId", String(rec?.runId) === k1.id || String(rec?.runId) === k2.id, String(rec?.runId));

  const bad = mcpTool('t', DEMO, 'get_order', { orderId: 'missing-7' });
  const rb = await run({ nodes: [s, bad, e], edges: linear(s, bad, e) });
  check('isError: true → node fails without a retry', rb.byId.t.status === 'failed' && rb.byId.t.attempts === 1 && rb.byId.t.logs.some((l) => /returned an error/.test(l)), `attempts=${rb.byId.t.attempts}`);
  const wrongType = mcpTool('t', DEMO, 'search_kb', { query: 'refund', limit: 'lots' });
  const rw = await run({ nodes: [s, wrongType, e], edges: linear(s, wrongType, e) });
  check('argument failing the tool schema → permanent failure naming the field', rw.byId.t.status === 'failed' && rw.byId.t.attempts === 1 && rw.byId.t.logs.some((l) => /limit/.test(l)), rw.byId.t.logs.at(-1));
  const gone = mcpTool('t', DEMO, 'teleport_customer', {});
  const rg = await run({ nodes: [s, gone, e], edges: linear(s, gone, e) });
  check('tool no longer offered → permanent failure', rg.byId.t.status === 'failed' && rg.byId.t.logs.some((l) => /is not offered by/.test(l)));

  // Kill the stdio child mid-life: the next call is retried until the pool reconnects.
  const pid = mcpPool.describe(DEMO)?.pid;
  check('pool keeps one stdio process per connection', Number.isInteger(pid));
  process.kill(pid, 'SIGKILL');
  await sleep(300);
  const order = mcpTool('t', DEMO, 'get_order', { orderId: '1042' }, { maxAttempts: 6 });
  const rk = await run({ nodes: [s, order, e], edges: linear(s, order, e) });
  check('killed stdio process → call retried and succeeds after reconnect', rk.byId.t.status === 'success' && rk.byId.t.attempts > 1, `attempts=${rk.byId.t.attempts} ${rk.byId.t.logs.at(-1) || ''}`);
  check('…with a new child process', mcpPool.describe(DEMO)?.pid && mcpPool.describe(DEMO).pid !== pid);

  // Deleting a connection closes its pool entry and kills the child.
  const tmp = await makeConnection({ name: 'Short lived', config: { transport: 'stdio', allowlistId: 'agentflow-demo' } });
  await mcpPool.listTools(await resolved(WS, tmp), WS);
  const tmpPid = mcpPool.describe(tmp)?.pid;
  mcpPool.close(tmp);
  await sleep(400);
  let alive = true;
  try { process.kill(tmpPid, 0); } catch { alive = false; }
  check('closing a pool entry kills its stdio process', Number.isInteger(tmpPid) && !alive);
}

// =================================================================== C: remote Streamable HTTP through safeRequest
console.log('\nC. remote Streamable HTTP transport through safeRequest');
{
  const blocked = await makeConnection({ name: 'Blocked', config: { transport: 'http', url: TEST_URL } });
  const tb = await IntegrationRegistry.testConnection('mcp', { connection: await resolved(WS, blocked), workspaceId: WS });
  check('127.0.0.1 server blocked by network policy by default', !tb.ok && /blocked by network policy/.test(tb.message), tb.message);
  check('…and the server never saw a request', httpState.requests.length === 0);
  for (const url of ['http://169.254.169.254/mcp', 'http://10.1.2.3/mcp', 'http://localhost:1/mcp']) {
    const c = { id: String(new mongoose.Types.ObjectId()), name: url, mode: 'live', credentials: {}, config: { transport: 'http', url } };
    let err = null;
    try { await mcpPool.listTools(c, WS); } catch (e2) { err = e2; }
    check(`blocked: ${url}`, err?.permanent === true && /network policy/.test(err.message), err?.message);
  }

  mcpPool.testOptions.allowPrivateNetworks = true; // like HTTP_TOOL_ALLOW_PRIVATE_NETWORKS=true
  const REMOTE = await makeConnection({ name: 'Remote Check', config: { transport: 'http', url: TEST_URL }, credentials: { authHeader: SECRET } });
  const tr = await IntegrationRegistry.testConnection('mcp', { connection: await resolved(WS, REMOTE), workspaceId: WS });
  check('with private networks allowed: initialize + tools/list works', tr.ok && /check-http/.test(tr.message) && /6 tools/.test(tr.message), tr.message);
  check('every request went through safeRequest (its User-Agent)', httpState.requests.length > 0 && httpState.requests.every((r) => r.ua.startsWith('AgentFlow/')), httpState.requests.map((r) => r.ua).join(' | '));
  check('standalone GET SSE stream is not opened (405 locally)', !httpState.requests.some((r) => r.method === 'GET'));

  const s = node('s', 'start');
  const e = node('e', 'end');
  const who = await run({ nodes: [s, mcpTool('t', REMOTE, 'whoami'), e], edges: linear(s, mcpTool('t', REMOTE, 'whoami'), e) });
  check('auth header sent to the server', httpState.lastAuth === SECRET);
  check('session header kept: calls after initialize succeed', who.runDoc.status === 'success');
  const stored = JSON.stringify(await Run.findById(who.id).lean());
  check('server echoing the credential is redacted before storage', !stored.includes('sk-test-SECRET') && /auth=/.test(who.byId.t.output?.text || ''), who.byId.t.output?.text);

  const img = await run({ nodes: [s, mcpTool('t', REMOTE, 'echo_image'), e], edges: linear(s, mcpTool('t', REMOTE, 'echo_image'), e) });
  const block = img.byId.t.output?.content?.[0];
  check('image blocks stored as metadata only', block?.type === 'image' && block.mimeType === 'image/png' && block.bytes === 1500 && img.byId.t.output.text === 'here it is');
  check('…no base64 image data in the run document', !JSON.stringify(await Run.findById(img.id).lean()).includes(IMAGE_B64.slice(0, 40)));

  const st = await run({ nodes: [s, mcpTool('t', REMOTE, 'structured', { invoiceId: 'in_1' }), e], edges: linear(s, mcpTool('t', REMOTE, 'structured'), e) });
  check('structuredContent is the output as-is', st.byId.t.output?.total === 12.5 && st.byId.t.output?.invoiceId === 'in_1');
  const f = await run({ nodes: [s, mcpTool('t', REMOTE, 'fail'), e], edges: linear(s, mcpTool('t', REMOTE, 'fail'), e) });
  check('remote isError → permanent, one attempt', f.byId.t.status === 'failed' && f.byId.t.attempts === 1);
  const slow = await run({ nodes: [s, mcpTool('t', REMOTE, 'slow', {}, { maxAttempts: 3 }), e], edges: linear(s, mcpTool('t', REMOTE, 'slow'), e) });
  check('timeout (MCP_CALL_TIMEOUT_MS) is retried and then succeeds', slow.byId.t.status === 'success' && slow.byId.t.attempts >= 2, `attempts=${slow.byId.t.attempts}`);
}

// =================================================================== D: agents with tools (mock provider)
console.log('\nD. agent tool use (mock provider, calls tools for real)');
{
  const s = node('s', 'start');
  const e = node('e', 'end');
  const agent = (id, tools, extra = {}) => node(id, 'agent', { systemPrompt: 'Help the customer.', tools, ...extra });
  const T = (action, connectionId = DEMO) => ({ integration: 'mcp', action, connectionId });
  const input = { customerId: '42', question: 'Find the customer tier, then search the knowledge base for refund' };

  emitted.length = 0;
  const a = agent('a', [T('lookup_customer'), T('search_kb')]);
  const r1 = await run({ nodes: [s, a, e], edges: linear(s, a, e) }, { input });
  const calls = r1.byId.a.toolCalls || [];
  check('agent with tools completes', r1.runDoc.status === 'success', r1.byId.a.logs?.at(-1));
  check('mock picks lookup_customer, filling id from customerId', calls[0]?.tool?.action === 'lookup_customer' && calls[0]?.args?.id === '42', JSON.stringify(calls[0]?.args));
  check('…then the runner-up (search_kb) as a second step', calls[1]?.tool?.action === 'search_kb' && calls.length === 2);
  check('tool calls persisted with status/attempts/timing', calls.every((c) => c.status === 'success' && c.attempts >= 1 && typeof c.durationMs === 'number' && c.step >= 1));
  check('agentSteps recorded', r1.byId.a.agentSteps === 2);
  check('final answer templates the tool outputs', /lookup_customer/.test(r1.byId.a.output?.reply || '') && /tier/.test(r1.byId.a.output?.reply || ''), r1.byId.a.output?.reply);
  const ev = emitted.filter((x) => x.event === 'agent:tool_call');
  check('agent:tool_call streamed started + success per call', ev.filter((x) => x.payload.status === 'started').length === 2 && ev.filter((x) => x.payload.status === 'success').length === 2);
  const p = ev.find((x) => x.payload.status === 'success')?.payload;
  check('event payload shape', p && p.runId === r1.id && p.nodeId === 'a' && p.step === 1 && p.tool?.integration === 'mcp' && p.tool?.name && 'durationMs' in p && ev[0].room === `run:${r1.id}`);
  const nodeUpdates = emitted.filter((x) => x.event === 'node:update' && x.payload.nodeId === 'a');
  check('node:update carries agentSteps (not full tool outputs)', nodeUpdates.some((x) => x.payload.agentSteps === 2) && nodeUpdates.every((x) => !('toolCalls' in x.payload)));

  const r2 = await run({ nodes: [s, a, e], edges: linear(s, a, e) }, { input });
  const sig = (r) => (r.byId.a.toolCalls || []).map((c) => `${c.tool.action}:${JSON.stringify(c.args)}`).join('|');
  check('same input + tools → same choices', sig(r1) === sig(r2), `${sig(r1)} vs ${sig(r2)}`);

  const side = agent('a', [T('lookup_customer'), T('create_ticket')]);
  const rs = await run({ nodes: [s, side, e], edges: linear(s, side, e) }, { input });
  check('side-effecting tool without allowSideEffects → node fails', rs.byId.a.status === 'failed' && rs.byId.a.logs.some((l) => /side effects aren't allowed/.test(l)));
  const sideOk = agent('a', [T('lookup_customer'), T('create_ticket')], { allowSideEffects: true });
  const rso = await run({ nodes: [s, sideOk, e], edges: linear(s, sideOk, e) }, { input });
  check('…runs once allowSideEffects is set', rso.byId.a.status === 'success');
  check('save-time check flags the same agent', /side effects aren't allowed/.test(await validateAgentTools(WS, [side]) || '') && (await validateAgentTools(WS, [sideOk])) === null);

  const tooMany = agent('a', Array.from({ length: 21 }, () => T('lookup_customer')));
  const rt = await run({ nodes: [s, tooMany, e], edges: linear(s, tooMany, e) });
  check('more than 20 tools → permanent failure', rt.byId.a.status === 'failed' && rt.byId.a.logs.some((l) => /at most 20 tools/.test(l)));

  const withGone = agent('a', [T('lookup_customer'), T('vanished_tool')]);
  const rv = await run({ nodes: [s, withGone, e], edges: linear(s, withGone, e) }, { input });
  check('a tool the server no longer offers is dropped, with a log line', rv.byId.a.status === 'success' && rv.byId.a.logs.some((l) => /dropped tool mcp\.vanished_tool/.test(l)));

  // Handoff + tools: the tool result decides the route.
  const tier = r1.byId.a.toolCalls[0].output.tier;
  const h = agent('h', [T('lookup_customer')], { isHandoff: true, candidates: ['gold', 'silver', 'bronze'] });
  const g = node('gold', 'end'); const sv = node('silver', 'end'); const bz = node('bronze', 'end');
  const rh = await run({ nodes: [s, h, g, sv, bz], edges: [edge('s', 'h'), edge('h', 'gold', { label: 'gold' }), edge('h', 'silver', { label: 'silver' }), edge('h', 'bronze', { label: 'bronze' })] }, { input: { customerId: '42' } });
  const taken = ['gold', 'silver', 'bronze'].filter((k) => rh.byId[k].status === 'success');
  check('handoff agent uses a tool, then routes on its result', rh.byId.h.toolCalls?.length === 1 && taken.length === 1 && taken[0] === tier, `tier=${tier} taken=${taken}`);

  // Secrets never reach toolCalls.
  const ra = await run({ nodes: [s, agent('a', [{ integration: 'mcp', action: 'whoami', connectionId: (await Connection.findOne({ name: 'Remote Check' }))._id.toString() }]), e], edges: linear(s, node('a', 'agent'), e) }, { input: { ask: 'whoami' } });
  check('agent tool outputs are redacted', ra.byId.a.status === 'success' && !JSON.stringify(ra.byId.a.toolCalls || []).includes('sk-test-SECRET'), JSON.stringify(ra.byId.a.toolCalls?.[0]?.output));
}

// =================================================================== E: no deadlock
console.log(`\nE. no deadlock: 3 agents with tools at QUEUE_CONCURRENCY=${queue.concurrency}`);
{
  const s = node('s', 'start');
  const e = node('e', 'end');
  const a = node('a', 'agent', { tools: [{ integration: 'mcp', action: 'lookup_customer', connectionId: DEMO }, { integration: 'mcp', action: 'search_kb', connectionId: DEMO }] });
  const started = Date.now();
  const all = await Promise.race([
    Promise.all([1, 2, 3].map((i) => run({ nodes: [s, a, e], edges: linear(s, a, e) }, { input: { customerId: String(100 + i), question: 'Find the customer tier, then search the knowledge base' } }))),
    sleep(45_000).then(() => null),
  ]);
  check('all three complete (no pool deadlock)', all !== null && all.every((r) => r.runDoc.status === 'success'), all ? all.map((r) => r.runDoc.status).join(',') : 'timed out');
  check(`finished in ${((Date.now() - started) / 1000).toFixed(1)}s`, all !== null);
}

// =================================================================== F: LLM loop with a stubbed Messages API
console.log('\nF. LLM tool-use loop (stubbed Anthropic client)');
{
  const s = node('s', 'start');
  const e = node('e', 'end');
  const tools = [{ integration: 'mcp', action: 'lookup_customer', connectionId: DEMO }, { integration: 'mcp', action: 'search_kb', connectionId: DEMO }];
  const text = (t) => ({ type: 'text', text: t });
  const tu = (id, name, input) => ({ type: 'tool_use', id, name, input });
  const msg = (stop_reason, content) => ({ id: `msg_${Math.random()}`, type: 'message', role: 'assistant', stop_reason, content });

  function stub(script) {
    const requests = [];
    const create = async (req) => { requests.push(JSON.parse(JSON.stringify(req))); return script(req, requests.length); };
    return { requests, client: { beta: { messages: { create } }, messages: { create } } };
  }
  async function withLlm(script, graphAgent, input = { customerId: '42' }) {
    const st = stub(script);
    __setAgentProviderForTests(new LLMAgentProvider({ apiKey: 'test', requestOptions: llmRequestOptions, client: st.client }));
    try {
      const r = await run({ nodes: [s, graphAgent, e], edges: linear(s, graphAgent, e) }, { input });
      return { ...r, requests: st.requests };
    } finally {
      __setAgentProviderForTests(new MockAgentProvider());
    }
  }
  const agentNode = (extra = {}) => node('a', 'agent', { tools, systemPrompt: 'Be useful.', ...extra });

  // 1. parallel tool_use → one user message with both tool_results
  const p = await withLlm((req, n) => (n === 1
    ? msg('tool_use', [{ type: 'thinking', thinking: '', signature: 'sig-1' }, tu('tu_1', req.tools[0].name, { id: '42' }), tu('tu_2', req.tools[1].name, { query: 'refund' })])
    : msg('end_turn', [text('Customer 42 found; refunds within 30 days.')])), agentNode());
  const second = p.requests[1];
  const lastUser = second?.messages?.at(-1);
  check('LLM agent completes a multi-step loop', p.runDoc.status === 'success' && /refunds within 30 days/.test(p.byId.a.output?.reply || ''));
  check('request uses ANTHROPIC_MODEL (default claude-opus-5), adaptive thinking, fallbacks', p.requests[0].model === 'claude-opus-5' && p.requests[0].thinking?.type === 'adaptive' && p.requests[0].betas?.includes('server-side-fallback-2026-07-01') && p.requests[0].fallbacks === 'default');
  check('tool names are <connectionSlug>__<tool>', p.requests[0].tools.map((t) => t.name).join(',') === 'demo_tools__lookup_customer,demo_tools__search_kb', p.requests[0].tools.map((t) => t.name).join(','));
  check('tool input_schema comes from the MCP inputSchema', p.requests[0].tools[1].input_schema?.required?.includes('query'));
  check('both tool calls ran (in parallel, same step)', p.byId.a.toolCalls?.length === 2 && p.byId.a.toolCalls.every((c) => c.step === 1));
  check('assistant turn echoed back unchanged (incl. thinking block)', second?.messages?.[1]?.role === 'assistant' && second.messages[1].content[0].type === 'thinking' && second.messages[1].content[0].signature === 'sig-1');
  check('ALL tool_results in ONE user message', second?.messages?.length === 3 && lastUser.role === 'user' && lastUser.content.length === 2 && lastUser.content.every((b) => b.type === 'tool_result') && lastUser.content.map((b) => b.tool_use_id).join() === 'tu_1,tu_2');

  // 2. unknown tool → is_error result, loop continues
  const u = await withLlm((req, n) => (n === 1 ? msg('tool_use', [tu('tu_x', 'nope__x', {})]) : msg('end_turn', [text('Sorry, I could not do that.')])), agentNode());
  const errBlock = u.requests[1]?.messages?.at(-1)?.content?.[0];
  check('unknown tool → tool_result with is_error, node still succeeds', u.runDoc.status === 'success' && errBlock?.is_error === true && /Unknown tool/.test(errBlock.content));

  // 3. step cap: always tool_use → 8 steps, then tool_choice none
  const capFinal = await withLlm((req) => (req.tool_choice?.type === 'none' ? msg('end_turn', [text('Final answer after the cap.')]) : msg('tool_use', [tu(`tu_${Math.random()}`, req.tools[1].name, { query: 'refund' })])), agentNode());
  const forced = capFinal.requests.filter((r) => r.tool_choice?.type === 'none');
  check(`stops at ${MAX_STEPS} steps, then one request with tool_choice none`, capFinal.runDoc.status === 'success' && capFinal.byId.a.agentSteps === MAX_STEPS && capFinal.requests.length === MAX_STEPS + 1 && forced.length === 1, `steps=${capFinal.byId.a.agentSteps} requests=${capFinal.requests.length}`);
  const capFail = await withLlm((req) => msg('tool_use', [tu(`tu_${Math.random()}`, req.tools[1].name, { query: 'refund' })]), agentNode());
  check('still calling tools after the forced final → fails', capFail.byId.a.status === 'failed' && capFail.byId.a.logs.some((l) => /exceeded 8 tool-use steps/.test(l)));

  // 4. refusal → permanent; max_tokens → retried
  const ref = await withLlm(() => msg('refusal', []), agentNode());
  check('refusal stop reason fails the node permanently', ref.byId.a.status === 'failed' && ref.requests.length === 1 && ref.byId.a.logs.some((l) => /Model declined the request/.test(l)));
  const mt = await withLlm((req, n) => (n === 1 ? msg('max_tokens', [text('partial')]) : msg('end_turn', [text('ok now')])), agentNode());
  check('max_tokens is a retryable turn failure', mt.runDoc.status === 'success' && mt.requests.length === 2);

  // 5. no tools: run() also uses the configured model
  const plain = await withLlm(() => msg('end_turn', [{ type: 'thinking', thinking: '', signature: 's' }, text('hello')]), node('a', 'agent', { systemPrompt: 'hi' }));
  check('agent without tools: run() uses the configured model, reads text blocks', plain.byId.a.output?.reply === 'hello' && plain.requests[0].model === 'claude-opus-5');
}

// =================================================================== G: workspace isolation of demo data
console.log('\nG. demo-server data is isolated per workspace');
{
  await SandboxRecord.create({ workspaceId: WS, integration: 'agentflow-demo', collectionName: 'agentflow-demo.customers', doc: { customerId: 'iso-1', name: 'Only In A', email: 'a@x.test', tier: 'gold', since: '2020-01-01' } });
  const a = await IntegrationRegistry.run({ config: { integration: 'mcp', action: 'lookup_customer', connectionId: DEMO, params: { id: 'iso-1' } }, input: null, context: { workspaceId: WS } });
  const bRes = await IntegrationRegistry.run({ config: { integration: 'mcp', action: 'lookup_customer', connectionId: DEMO_B, params: { id: 'iso-1' } }, input: null, context: { workspaceId: WS_B } });
  check('workspace A reads its own record', a.output?.name === 'Only In A');
  check("workspace B can't read A's record", bRes.output?.name !== 'Only In A', bRes.output?.name);
  const bTickets = await SandboxRecord.countDocuments({ workspaceId: WS_B, collectionName: 'agentflow-demo.tickets' });
  check("A's tickets never land in B", bTickets === 0);
  let err = null;
  try {
    await IntegrationRegistry.run({ config: { integration: 'mcp', action: 'lookup_customer', connectionId: DEMO, params: { id: '1' } }, input: null, context: { workspaceId: WS_B } });
  } catch (e2) { err = e2; }
  check("another workspace's connection id doesn't resolve", err?.permanent === true && /Connection not found/.test(err.message));
}

// =================================================================== H: over HTTP against BASE (INTEGRATIONS_LIVE=false)
console.log('\nH. API rules + sandbox mode over HTTP (server runs INTEGRATIONS_LIVE=false)');
{
  const call = async (method, p, { token, ws, body } = {}) => {
    const res = await fetch(B + p, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...(ws && { 'X-Workspace-Id': ws }) }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const reg = await call('POST', '/auth/register', { body: { email: `mcp${Date.now()}@check.dev`, password: 'password123', name: 'Mia MCP' } });
  const token = reg.body?.token;
  const ws = reg.body?.workspaces?.[0]?.id;
  const allow = await call('GET', '/mcp/allowlist', { token, ws });
  check('GET /api/mcp/allowlist → ids without command/args/env', allow.status === 200 && allow.body.some((e) => e.id === 'agentflow-demo') && allow.body.every((e) => !e.command && !e.args && !e.env));

  const mk = (config, extra = {}) => call('POST', '/connections', { token, ws, body: { integration: 'mcp', name: `c${Math.random()}`, config, ...extra } });
  check('a command can never be submitted (400)', (await mk({ transport: 'stdio', allowlistId: 'agentflow-demo', command: 'rm' })).status === 400);
  check('unknown allowlistId → 400', (await mk({ transport: 'stdio', allowlistId: 'nope' })).status === 400);
  check('stdio with a URL → 400', (await mk({ transport: 'stdio', allowlistId: 'agentflow-demo', url: 'https://x.test' })).status === 400);
  check('remote without URL → 400; non-http URL → 400', (await mk({ transport: 'http' })).status === 400 && (await mk({ transport: 'http', url: 'ftp://x.test/mcp' })).status === 400);

  const demo = await mk({ transport: 'stdio', allowlistId: 'agentflow-demo' });
  check('allowlisted stdio connection created (defaults to live mode)', demo.status === 201 && demo.body?.mode === 'live', JSON.stringify(demo.body));
  const test = await call('POST', `/connections/${demo.body.id}/test`, { token, ws });
  check('test: sandboxSafe demo server is reached even with live off', test.body?.status === 'ok' && /4 tools/.test(test.body?.detail || ''), JSON.stringify(test.body));
  const tools = await call('GET', `/workspaces/${ws}/connections/${demo.body.id}/mcp/tools`, { token });
  const kb = tools.body?.tools?.find((t) => t.name === 'search_kb');
  check('GET …/mcp/tools lists tools with generated forms', tools.status === 200 && tools.body.tools.length === 4 && kb?.configSchema?.find((f) => f.key === 'limit')?.type === 'number' && kb.readOnly === true, `${tools.status} ${tools.body?.source}`);
  const refresh = await call('POST', `/connections/${demo.body.id}/mcp/refresh`, { token, ws });
  check('POST …/mcp/refresh re-runs discovery (source live)', refresh.status === 200 && refresh.body.source === 'live');

  const remote = await mk({ transport: 'http', url: TEST_URL }, { credentials: { authHeader: SECRET } });
  check('remote connection created (URL not contacted on create)', remote.status === 201);
  const offline = await call('GET', `/connections/${remote.body.id}/mcp/tools`, { token, ws });
  check('sandbox mode + no snapshot → clear offline error', offline.status === 400 && /No tool list available offline/.test(offline.body?.error || ''), JSON.stringify(offline.body));

  // Give the remote connection a snapshot directly, the way a past live test would have.
  const baseConn = await mongoose.createConnection(ORIGINAL_DB).asPromise();
  const snapshot = {
    fetchedAt: new Date(), serverInfo: { name: 'check-http', version: '0.9.0' },
    fingerprint: targetFingerprint({ config: { transport: 'http', url: TEST_URL } }),
    tools: [
      { name: 'structured', description: 'invoice total', inputSchema: { type: 'object', properties: { invoiceId: { type: 'string' } }, required: ['invoiceId'] }, outputSchema: { type: 'object', properties: { total: { type: 'number' }, currency: { type: 'string' } } }, annotations: { readOnlyHint: true } },
      { name: 'plain', description: 'no schema', inputSchema: { type: 'object', properties: { q: { type: 'string' } } }, annotations: {} },
    ],
  };
  await baseConn.collection('connections').updateOne({ _id: new mongoose.Types.ObjectId(remote.body.id) }, { $set: { 'config.toolsSnapshot': snapshot } });
  const snapTools = await call('GET', `/connections/${remote.body.id}/mcp/tools`, { token, ws });
  check('snapshot served offline (source snapshot)', snapTools.status === 200 && snapTools.body.source === 'snapshot' && snapTools.body.tools.length === 2);

  const before = httpState.requests.length;
  const wf = await call('POST', '/workflows', { token, ws, body: { name: 'mcp sandbox' } });
  const N = (id, type, config) => ({ id, type, position: { x: 0, y: 0 }, data: { config: { label: id, ...config } } });
  const graph = {
    nodes: [N('s', 'start', {}), N('m1', 'tool', { integration: 'mcp', action: 'structured', connectionId: remote.body.id, params: { invoiceId: 'in_9' } }), N('m2', 'tool', { integration: 'mcp', action: 'plain', connectionId: remote.body.id, params: { q: 'hi' } }), N('d', 'tool', { integration: 'mcp', action: 'lookup_customer', connectionId: demo.body.id, params: { id: '7' } }), N('e', 'end', {})],
    edges: [{ id: 'a', source: 's', target: 'm1' }, { id: 'b', source: 's', target: 'm2' }, { id: 'c', source: 's', target: 'd' }, { id: 'x', source: 'm1', target: 'e' }, { id: 'y', source: 'm2', target: 'e' }, { id: 'z', source: 'd', target: 'e' }],
  };
  const put = await call('PUT', `/workflows/${wf.body._id}`, { token, ws, body: graph });
  check('workflow with MCP nodes saves', put.status === 200, JSON.stringify(put.body?.error || ''));
  const started = await call('POST', `/workflows/${wf.body._id}/runs`, { token, ws });
  let runDoc = null;
  for (let i = 0; i < 60; i += 1) {
    await sleep(250);
    const got = await call('GET', `/runs/${started.body?.runId}`, { token, ws });
    if (got.body && !['pending', 'running'].includes(got.body.status)) { runDoc = got.body; break; }
  }
  const by = Object.fromEntries((runDoc?.nodeResults || []).map((r) => [r.nodeId, r]));
  check('sandbox: outputSchema-shaped placeholder with sandbox: true', by.m1?.status === 'success' && by.m1.output?.sandbox === true && 'total' in (by.m1.output || {}) && by.m1.mode === 'sandbox', JSON.stringify(by.m1?.output));
  check('sandbox: no outputSchema → "[sandbox] … would be called with" text', by.m2?.output?.sandbox === true && /\[sandbox\] plain would be called with/.test(by.m2.output.text || ''));
  check('sandbox: zero requests reached the remote server', httpState.requests.length === before, `${httpState.requests.length - before} requests`);
  check('sandboxSafe demo server is still called for real', by.d?.status === 'success' && by.d.mode === 'live' && by.d.output?.id === '7' && !by.d.output?.sandbox);
  const del = await call('DELETE', `/connections/${demo.body.id}?force=true`, { token, ws });
  check('deleting an MCP connection works (pool entry closed server-side)', del.status === 204);
  await baseConn.close();
}

// ------------------------------------------------------------------ cleanup
await mcpPool.closeAll();
await new Promise((r) => testServer.close(r));
await mongoose.connection.dropDatabase();
await mongoose.disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
