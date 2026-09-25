/**
 * Live smoke test for the configured real-model provider - the one script that
 * deliberately spends tokens (about three short requests per model).
 *
 *   # in server/.env: AGENT_PROVIDER=openai + OPENAI_API_KEY
 *   #             or: AGENT_PROVIDER=openrouter + OPENROUTER_API_KEY
 *   npm run try:llm
 *   npm run try:llm -- --list-free        # OpenRouter's free models that support tools
 *   npm run try:llm -- --models openrouter/free,qwen/qwen3.8-27b:free
 *
 * Per model:
 * 1. one plain agent call (provider.run)
 * 2. a real workflow run - Start → agent with the built-in calculator tool →
 *    End - through the engine and job queue, so the model has to call a tool
 *    and use its result. A model that answers without calling the tool (or
 *    can't do tool calling at all) is reported as such.
 *
 * `--models` compares several models on the configured provider and prints a
 * summary table - the quick way to pick a free OpenRouter model that handles
 * tools. Uses a throwaway `-llmsmoke` database and drops it afterwards.
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import {
  getAgentProvider, openaiRequestOptions, openrouterRequestOptions, __setAgentProviderForTests,
} from '../config/agentProvider.js';
import { OpenAIAgentProvider } from '../providers/OpenAIAgentProvider.js';

// Read-only and key-free: OpenRouter's public model list, filtered to free
// models that accept `tools` (agent nodes with tools need that).
if (process.argv.includes('--list-free')) {
  const res = await fetch(`${env.openrouterBaseUrl}/models`);
  if (!res.ok) { console.log(`Couldn't load the model list (HTTP ${res.status}).`); process.exit(1); }
  const all = (await res.json()).data || [];
  const free = all.filter((m) => m.id.endsWith(':free') || (Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0));
  const withTools = free.filter((m) => (m.supported_parameters || []).includes('tools'))
    .sort((a, b) => (b.context_length || 0) - (a.context_length || 0));
  console.log(`${withTools.length} free OpenRouter models support tool calling (of ${free.length} free, ${all.length} total):\n`);
  for (const m of withTools) console.log(`  ${m.id.padEnd(56)} ${String(m.context_length || '').padStart(8)} ctx`);
  console.log('\nPick one for OPENROUTER_MODEL, or compare a few: npm run try:llm -- --models <id>,<id>');
  process.exit(0);
}

if (env.agentProvider === 'mock') {
  console.log('AGENT_PROVIDER is "mock" - nothing real to test.');
  console.log('In server/.env set AGENT_PROVIDER=openrouter (+ OPENROUTER_API_KEY) or AGENT_PROVIDER=openai (+ OPENAI_API_KEY), then run this again.');
  process.exit(1);
}

const argIndex = process.argv.indexOf('--models');
const requested = argIndex > -1 ? (process.argv[argIndex + 1] || '').split(',').map((m) => m.trim()).filter(Boolean) : [];
const configuredModel = { openai: env.openaiModel, openrouter: env.openrouterModel, anthropic: env.anthropicModel }[env.agentProvider];
const models = requested.length ? requested : [configuredModel];

if (requested.length && !['openai', 'openrouter'].includes(env.agentProvider)) {
  console.log('--models is supported for AGENT_PROVIDER=openai or openrouter.');
  process.exit(1);
}

/** The configured provider, or the same one pointed at another model. */
function providerFor(model) {
  if (!requested.length) return getAgentProvider();
  const isOpenRouter = env.agentProvider === 'openrouter';
  return new OpenAIAgentProvider({
    name: env.agentProvider,
    apiKey: isOpenRouter ? env.openrouterApiKey : env.openaiApiKey,
    baseURL: isOpenRouter ? env.openrouterBaseUrl : (env.openaiBaseUrl || null),
    requestOptions: { ...(isOpenRouter ? openrouterRequestOptions : openaiRequestOptions), model },
    ...(isOpenRouter && { defaultHeaders: { 'X-Title': env.openrouterAppName, ...(env.openrouterAppUrl && { 'HTTP-Referer': env.openrouterAppUrl }) } }),
  });
}

const DB = `${env.mongodbUri.replace(/\/+$/, '')}-llmsmoke`;
await mongoose.connect(DB);
const { executeRun } = await import('../engine/executeRun.js');
const { default: Run } = await import('../models/Run.js');
const node = (id, type, config = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { config: { label: id, ...config } } });
const EXPECTED = 1234 * 5678 - 99;

async function tryModel(model) {
  const provider = providerFor(model);
  __setAgentProviderForTests(provider);
  const row = { model, plain: '✗', tools: '✗', answer: '', note: '' };
  console.log(`\n── ${env.agentProvider} · ${model}`);

  const t0 = Date.now();
  try {
    const r = await provider.run({ label: 'Smoke', systemPrompt: 'Reply in at most eight words.' }, 'Say hello to the AgentFlow team.');
    row.plain = '✓';
    console.log(`1. plain call ✓ (${Date.now() - t0} ms): ${r.output?.reply}`);
  } catch (err) {
    row.note = err.message;
    console.log(`1. plain call ✗ ${err.message}`);
    return row; // a model that can't answer a plain prompt won't do tools either
  }

  const WS = new mongoose.Types.ObjectId();
  const wf = {
    _id: new mongoose.Types.ObjectId(),
    workspaceId: WS,
    nodes: [
      node('s', 'start'),
      node('a', 'agent', {
        label: 'Math helper',
        systemPrompt: 'Use the calculator tool for any arithmetic, then answer in one sentence.',
        tools: [{ integration: 'builtin', action: 'calculator', connectionId: null }],
      }),
      node('e', 'end'),
    ],
    edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
  };
  const input = { question: 'What is 1234 * 5678, minus 99?' };
  const doc = await Run.create({ workflowId: wf._id, workspaceId: WS, status: 'pending', input });
  const t1 = Date.now();
  const finished = await executeRun(doc._id.toString(), wf, { input });
  const a = finished.nodeResults.find((r) => r.nodeId === 'a');
  const calls = a?.toolCalls || [];
  const reply = a?.output?.reply || '';
  row.answer = reply.slice(0, 80);
  const usedTool = calls.some((c) => c.status === 'success');
  const correct = reply.replace(/[,\s]/g, '').includes(String(EXPECTED));
  row.tools = finished.status === 'success' && usedTool ? (correct ? '✓' : '~') : '✗';
  if (finished.status !== 'success') row.note = (a?.logs || []).slice(-1)[0] || finished.status;
  else if (!usedTool) row.note = 'answered without calling the tool';
  else if (!correct) row.note = 'called the tool but the answer is off';

  console.log(`2. workflow run ${finished.status} (${Date.now() - t1} ms, ${a?.attempts ?? '?'} attempt(s), ${a?.agentSteps ?? 0} tool step(s))`);
  for (const c of calls) console.log(`   tool ${c.tool?.action || c.tool?.name}(${JSON.stringify(c.args)}) → ${c.status} ${JSON.stringify(c.output ?? c.error)}`);
  console.log(`   answer: ${reply || '(none)'}   (expected ${EXPECTED})`);
  if (finished.status !== 'success') console.log(`   logs:\n     ${(a?.logs || []).slice(-5).join('\n     ')}`);
  return row;
}

const rows = [];
try {
  for (const model of models) rows.push(await tryModel(model));
} finally {
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
}

if (rows.length > 1) {
  console.log('\nSummary (tools: ✓ used the tool and got it right · ~ used it, answer off · ✗ no tool call / failed)');
  for (const r of rows) console.log(`  ${r.plain} plain  ${r.tools} tools  ${r.model.padEnd(34)} ${r.note}`);
}
process.exit(rows.every((r) => r.plain === '✓' && r.tools === '✓') ? 0 : 1);
