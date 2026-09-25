/**
 * Provider check - the OpenAI AgentProvider's request/response mapping, driven
 * with a stubbed `chat.completions.create`, so it spends no tokens and needs no
 * key.
 *
 *   npm run check:providers
 *
 * Covers the unit mapping (run, step, tool results, force-final, finish
 * reasons, API error classification) and then the real engine: an agent node
 * whose tool calls go through the job queue, end to end, with the stub standing
 * in for OpenAI. Uses a throwaway `-providercheck` database.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { env } from '../config/env.js';

const CHECK_DB = `${env.mongodbUri.replace(/\/+$/, '')}-providercheck`;
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

const { OpenAIAgentProvider } = await import('../providers/OpenAIAgentProvider.js');
const { MockAgentProvider } = await import('../providers/MockAgentProvider.js');
const { __setAgentProviderForTests, openaiRequestOptions } = await import('../config/agentProvider.js');
const { PermanentFailure } = await import('../queue/errors.js');

/** A chat.completions stub: `script(request, n)` returns the response for call n. */
function stub(script) {
  const requests = [];
  const create = async (req) => {
    requests.push(JSON.parse(JSON.stringify(req)));
    return script(req, requests.length);
  };
  return { requests, client: { chat: { completions: { create } } } };
}
const completion = (message, finish_reason = 'stop') => ({
  id: `chatcmpl-${Math.random()}`, model: 'gpt-5.4-mini-2026-03-17', choices: [{ index: 0, finish_reason, message: { role: 'assistant', ...message } }],
});
const toolCall = (id, name, args) => ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });
const provider = (st, opts = {}) => new OpenAIAgentProvider({ apiKey: 'test', requestOptions: { ...openaiRequestOptions, ...opts }, client: st.client });
const agentCfg = (extra = {}) => ({ label: 'Helper', systemPrompt: 'Be useful.', ...extra });
const tools = [
  { name: 'builtin__calculator', description: 'Evaluate arithmetic', inputSchema: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] } },
  { name: 'builtin__fake-weather', description: 'Weather', inputSchema: { properties: { city: { type: 'string' } } } },
];

async function throwsWith(fn) {
  try { await fn(); return null; } catch (err) { return err; }
}

// ================================================================ A: run()
console.log('A. run() - one call, no tools');
{
  const st = stub(() => completion({ content: '  Hello there.  ' }));
  const r = await provider(st).run(agentCfg(), { topic: 'greeting' });
  const req = st.requests[0];
  check('returns the reply text (trimmed)', r.output?.reply === 'Hello there.', JSON.stringify(r.output));
  check(`uses OPENAI_MODEL (default ${openaiRequestOptions.model})`, req.model === openaiRequestOptions.model, req.model);
  check('sends max_completion_tokens (not max_tokens)', req.max_completion_tokens === openaiRequestOptions.maxCompletionTokens && !('max_tokens' in req));
  check('reasoning_effort omitted when OPENAI_REASONING_EFFORT is unset', !('reasoning_effort' in req));
  check('system prompt first, then the input as a user message', req.messages[0].role === 'system' && req.messages[0].content === 'Be useful.' && req.messages[1].role === 'user' && req.messages[1].content === '{"topic":"greeting"}');
  check('no tools field on a plain call', !('tools' in req));
  check('logs name the provider and model', r.logs.some((l) => /OpenAI \(gpt-5\.4-mini/.test(l)), r.logs.join(' | '));

  const st2 = stub(() => completion({ content: 'x' }));
  await provider(st2, { reasoningEffort: 'low' }).run(agentCfg(), 'hi');
  check('reasoning_effort sent when configured', st2.requests[0].reasoning_effort === 'low');

  const hand = stub(() => completion({ content: 'Route this to Billing please' }));
  const h = await provider(hand).run(agentCfg({ isHandoff: true, candidates: ['Support', 'Billing'] }), 'refund?');
  check('handoff: picks the candidate named in the answer', h.handoffTarget === 'Billing' && /Billing/.test(hand.requests[0].messages[0].content));
}

// ================================================================ B: step()
console.log('\nB. step() - one turn of the tool-use loop');
{
  const st = stub(() => completion({ content: null, tool_calls: [toolCall('call_1', 'builtin__calculator', { expression: '6*7' }), toolCall('call_2', 'builtin__fake-weather', { city: 'Pune' })] }, 'tool_calls'));
  const p = provider(st);
  const t1 = await p.step(agentCfg(), { input: { q: 'hi' }, tools, history: [] });
  const req = st.requests[0];
  check('parallel tool calls come back as type tool_calls', t1.type === 'tool_calls' && t1.calls.length === 2);
  check('calls carry id, tool name and parsed args', t1.calls[0].id === 'call_1' && t1.calls[0].tool === 'builtin__calculator' && t1.calls[0].args.expression === '6*7');
  check('tools sent as type function with parameters', req.tools[0].type === 'function' && req.tools[0].function.name === 'builtin__calculator' && req.tools[0].function.parameters.required[0] === 'expression');
  check('a schema without type:object is normalised', req.tools[1].function.parameters.type === 'object' && req.tools[1].function.parameters.properties.city);
  check('parallel_tool_calls enabled', req.parallel_tool_calls === true);

  const st2 = stub(() => completion({ content: 'It is 42 and sunny.' }));
  const t2 = await provider(st2).step(agentCfg(), {
    input: { q: 'hi' },
    tools,
    history: [{ raw: t1.raw, calls: t1.calls, results: [{ id: 'call_1', content: '42' }, { id: 'call_2', content: 'boom', isError: true }] }],
  });
  const msgs = st2.requests[0].messages;
  check('final turn returns type final with the answer', t2.type === 'final' && t2.output.reply === 'It is 42 and sunny.');
  check('assistant turn echoed back with its tool_calls', msgs[2].role === 'assistant' && msgs[2].tool_calls.length === 2 && msgs[2].content === null);
  check('one tool message per call, matched by tool_call_id', msgs[3].role === 'tool' && msgs[3].tool_call_id === 'call_1' && msgs[3].content === '42' && msgs[4].tool_call_id === 'call_2');
  check('a failed tool result says so (no is_error in Chat Completions)', msgs[4].content === 'Error: boom');

  const st3 = stub(() => completion({ content: 'Final.', tool_calls: [toolCall('call_x', 'builtin__calculator', { expression: '1' })] }));
  const t3 = await provider(st3).step(agentCfg(), { input: 'x', tools, history: [{ raw: t1.raw, calls: t1.calls, results: [{ id: 'call_1', content: '1' }, { id: 'call_2', content: '2' }] }], forceFinal: true });
  const fr = st3.requests[0];
  check("forceFinal sends tool_choice 'none' and a closing user note", fr.tool_choice === 'none' && fr.messages.at(-1).role === 'user' && /tool-use limit/.test(fr.messages.at(-1).content));
  check('forceFinal returns final even if the model still emits tool calls', t3.type === 'final' && t3.output.reply === 'Final.');

  const st4 = stub(() => completion({ tool_calls: [toolCall('c', 'builtin__calculator', '{not json')] }, 'tool_calls'));
  const t4 = await provider(st4).step(agentCfg(), { input: 'x', tools, history: [] });
  check('malformed JSON arguments are kept as __invalid, never guessed', t4.calls[0].args.__invalid === '{not json');
}

// ================================================================ C: finish reasons and API errors
console.log('\nC. finish reasons and API error classification');
{
  const refusal = await throwsWith(() => provider(stub(() => completion({ content: null, refusal: 'I cannot help with that.' }))).run(agentCfg(), 'x'));
  check('refusal → PermanentFailure', refusal instanceof PermanentFailure && /declined/.test(refusal.message));
  const filtered = await throwsWith(() => provider(stub(() => completion({ content: '' }, 'content_filter'))).run(agentCfg(), 'x'));
  check('content_filter → PermanentFailure', filtered instanceof PermanentFailure);
  const length = await throwsWith(() => provider(stub(() => completion({ content: 'partial' }, 'length'))).run(agentCfg(), 'x'));
  check('length → a retryable error (not permanent)', length && !(length instanceof PermanentFailure) && /token limit/.test(length.message));
  const empty = await throwsWith(() => provider(stub(() => ({ choices: [] }))).run(agentCfg(), 'x'));
  check('no choices → retryable error', empty && !(empty instanceof PermanentFailure));

  const apiError = (status, extra = {}) => provider(stub(() => { const e = new Error(`HTTP ${status}`); e.status = status; Object.assign(e, extra); throw e; }));
  const e401 = await throwsWith(() => apiError(401, { error: { message: 'Incorrect API key provided' } }).run(agentCfg(), 'x'));
  check('401 (bad key) → PermanentFailure with the API message', e401 instanceof PermanentFailure && /401/.test(e401.message) && /Incorrect API key/.test(e401.message));
  const e404 = await throwsWith(() => apiError(404, { error: { message: 'The model does not exist' } }).run(agentCfg(), 'x'));
  check('404 (unknown model) → PermanentFailure', e404 instanceof PermanentFailure);
  const e429 = await throwsWith(() => apiError(429, { headers: new Headers({ 'retry-after': '3' }) }).run(agentCfg(), 'x'));
  check('429 → retryable, honouring Retry-After', e429 && !(e429 instanceof PermanentFailure) && e429.retryAfterMs === 3000);
  const e500 = await throwsWith(() => apiError(500).run(agentCfg(), 'x'));
  check('500 → retryable', e500 && !(e500 instanceof PermanentFailure));
  const e408 = await throwsWith(() => apiError(408).run(agentCfg(), 'x'));
  check('408 timeout → retryable', e408 && !(e408 instanceof PermanentFailure));
}

// ================================================================ D: boot-time config validation
console.log('\nD. env validation at boot');
{
  const boot = (extra) => spawnSync(process.execPath, ['-e', "import('./src/config/env.js').then(()=>console.log('BOOT_OK'))"], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)), env: { ...process.env, ...extra }, encoding: 'utf8',
  });
  const noKey = boot({ AGENT_PROVIDER: 'openai', OPENAI_API_KEY: '' });
  check('AGENT_PROVIDER=openai without OPENAI_API_KEY refuses to boot', noKey.status !== 0 && /requires OPENAI_API_KEY/.test(noKey.stderr));
  const bogus = boot({ AGENT_PROVIDER: 'gemini' });
  check('an unknown AGENT_PROVIDER refuses to boot with the allowed list', bogus.status !== 0 && /mock, openai, openrouter, anthropic/.test(bogus.stderr));
  const ok = boot({ AGENT_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' });
  check('AGENT_PROVIDER=openai with a key boots', ok.status === 0 && /BOOT_OK/.test(ok.stdout), String(ok.stderr || ok.error || '').slice(0, 200));
}

// ================================================================ D2: OpenRouter (OpenAI-compatible gateway)
console.log('\nD2. OpenRouter settings');
{
  const { openrouterRequestOptions } = await import('../config/agentProvider.js');
  const st = stub(() => completion({ content: null, tool_calls: [toolCall('c1', 'builtin__calculator', { expression: '2+2' })] }, 'tool_calls'));
  const orp = new OpenAIAgentProvider({ name: 'openrouter', apiKey: 'test', requestOptions: openrouterRequestOptions, client: st.client });
  await orp.step(agentCfg(), { input: 'x', tools, history: [] });
  const req = st.requests[0];
  check(`defaults to the free router (${openrouterRequestOptions.model})`, req.model === 'openrouter/free');
  check('sends max_tokens (not max_completion_tokens) for the gateway', req.max_tokens === openrouterRequestOptions.maxCompletionTokens && !('max_completion_tokens' in req));
  check('omits the OpenAI-only parallel_tool_calls', !('parallel_tool_calls' in req));
  check('still sends tools as type function', req.tools?.[0]?.type === 'function');
  check('provider reports its name', orp.name === 'openrouter' && orp.mode === 'llm');
  const r = await new OpenAIAgentProvider({ name: 'openrouter', apiKey: 't', requestOptions: openrouterRequestOptions, client: stub(() => completion({ content: 'hi' })).client }).run(agentCfg(), 'x');
  check('logs say OpenRouter', r.logs.some((l) => /called OpenRouter/.test(l)), r.logs.join(' | '));

  const boot = (extra) => spawnSync(process.execPath, ['-e', "import('./src/config/agentProvider.js').then((m)=>{const p=m.getAgentProvider();console.log('BOOT_OK', p.name, p.baseURL, p.requestOptions.model, JSON.stringify(p.defaultHeaders))})"], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)), env: { ...process.env, ...extra }, encoding: 'utf8',
  });
  const noKey = boot({ AGENT_PROVIDER: 'openrouter', OPENROUTER_API_KEY: '' });
  check('AGENT_PROVIDER=openrouter without OPENROUTER_API_KEY refuses to boot', noKey.status !== 0 && /requires OPENROUTER_API_KEY/.test(noKey.stderr));
  const ok = boot({ AGENT_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'qwen/qwen3.8-27b:free', OPENROUTER_APP_URL: 'http://localhost:5173' });
  check('openrouter boots with its base URL and the chosen model', ok.status === 0 && /BOOT_OK openrouter https:\/\/openrouter\.ai\/api\/v1 qwen\/qwen3\.8-27b:free/.test(ok.stdout), (ok.stdout + ok.stderr).trim().slice(0, 200));
  check('sends the OpenRouter attribution headers', /"HTTP-Referer":"http:\/\/localhost:5173"/.test(ok.stdout) && /"X-Title":"AgentFlow"/.test(ok.stdout), ok.stdout.trim().slice(0, 200));
  const gone = boot({ AGENT_PROVIDER: 'opencode', OPENCODE_API_KEY: 'k' });
  check('opencode is no longer an accepted provider', gone.status !== 0 && /must be one of/.test(gone.stderr));
}

// ================================================================ E: the real engine with the stub
console.log('\nE. end to end: agent with tools through the engine and job queue');
await mongoose.connect(CHECK_DB);
try {
  const { executeRun } = await import('../engine/executeRun.js');
  const { default: Run } = await import('../models/Run.js');
  const WS = new mongoose.Types.ObjectId();
  const node = (id, type, config = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { config: { label: id, ...config } } });
  const edge = (a, b) => ({ id: `${a}-${b}`, source: a, target: b });
  async function run(agent, script) {
    const st = stub(script);
    __setAgentProviderForTests(new OpenAIAgentProvider({ apiKey: 'test', requestOptions: openaiRequestOptions, client: st.client }));
    try {
      const wf = { _id: new mongoose.Types.ObjectId(), workspaceId: WS, nodes: [node('s', 'start'), agent, node('e', 'end')], edges: [edge('s', 'a'), edge('a', 'e')] };
      const doc = await Run.create({ workflowId: wf._id, workspaceId: WS, status: 'pending', input: { question: 'What is 6*7?' } });
      const finished = await executeRun(doc._id.toString(), wf, { input: doc.input });
      return { finished, byId: Object.fromEntries(finished.nodeResults.map((r) => [r.nodeId, r])), requests: st.requests };
    } finally {
      __setAgentProviderForTests(new MockAgentProvider());
    }
  }
  const agent = node('a', 'agent', {
    label: 'Math helper', systemPrompt: 'Use the calculator.',
    tools: [{ integration: 'builtin', action: 'calculator', connectionId: null }],
    mockOverrides: { maxAttempts: 2 },
  });
  const r = await run(agent, (req, n) => {
    if (n === 1) return completion({ content: null, tool_calls: [toolCall('call_1', req.tools[0].function.name, { expression: '6*7' })] }, 'tool_calls');
    const toolMsg = req.messages.find((m) => m.role === 'tool');
    return completion({ content: `The answer is ${JSON.parse(toolMsg.content).result ?? toolMsg.content}.` });
  });
  const a = r.byId.a;
  check('run succeeds', r.finished.status === 'success', r.finished.status);
  check('the model saw the integration action as a function tool', r.requests[0].tools?.[0]?.function?.name === 'builtin__calculator', r.requests[0].tools?.map((t) => t.function.name).join());
  check('the calculator really ran through the queue and its result went back to the model', a.toolCalls?.length === 1 && a.toolCalls[0].status === 'success' && r.requests[1].messages.some((m) => m.role === 'tool' && /42/.test(m.content)), JSON.stringify(a.toolCalls?.[0]?.output));
  check("the agent's final answer uses the tool result", /42/.test(a.output?.reply || ''), a.output?.reply);
  check('agentSteps recorded', a.agentSteps === 1, `${a.agentSteps}`);

  const flaky = await run(node('a', 'agent', { label: 'Flaky', systemPrompt: 'x' }), (req, n) => {
    if (n === 1) { const e = new Error('HTTP 503'); e.status = 503; throw e; }
    return completion({ content: 'recovered' });
  });
  check('a 503 is retried by the queue and the node recovers', flaky.byId.a.status === 'success' && flaky.byId.a.attempts === 2 && flaky.byId.a.output?.reply === 'recovered', `attempts=${flaky.byId.a.attempts}`);

  const badKey = await run(node('a', 'agent', { label: 'Bad key', systemPrompt: 'x' }), () => { const e = new Error('HTTP 401'); e.status = 401; e.error = { message: 'Incorrect API key provided' }; throw e; });
  check('a 401 fails the node in one attempt, with a readable reason', badKey.byId.a.status === 'failed' && badKey.byId.a.attempts === 1 && badKey.requests.length === 1 && badKey.byId.a.logs.some((l) => /Incorrect API key/.test(l)), badKey.byId.a.logs.slice(-1)[0]);
} finally {
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
