import Run from '../models/Run.js';
import { queue } from '../queue/index.js';
import { PermanentFailure } from '../queue/errors.js';
import { env } from '../config/env.js';
import { getAgentProvider } from '../config/agentProvider.js';
import { getIo } from '../sockets/ioInstance.js';
import { IntegrationRegistry } from '../integrations/IntegrationRegistry.js';
import { buildRedactor } from '../secrets/redact.js';
import { RunCancelledError } from './nodes/shared.js';

/**
 * Agent tool use (spec/37 §5). The ENGINE drives the loop, not the provider:
 *
 *   1. enqueue one agent turn  (provider.step)
 *   2. on tool_calls, enqueue each call as its own tool job, in parallel
 *   3. append the results to the state, enqueue the next turn
 *   4. stop on a final answer, a cancel, or the step cap
 *
 * Why here: if an agent were one queue job making nested tool calls on the same
 * bounded queue, N agents waiting on their own tools would hold every slot and
 * deadlock the pool. With the loop in the engine nothing holds a slot while it
 * waits (spec/33 §3), and every turn and every tool call separately gets the
 * queue's retries, fair scheduling, a cancellation check and a monitor line.
 */

export const MAX_TOOLS = 20;
export const MAX_STEPS = 8;
const SOCKET_OUTPUT_CHARS = 8000;
const STORED_OUTPUT_BYTES = 1_048_576;

function emit(runId, event, payload) {
  try {
    getIo().to(`run:${runId}`).emit(event, { runId, ...payload });
  } catch {
    // no socket layer in scripts
  }
}

const slugify = (s, max = 20) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max) || 'tool';
const toolName = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

/** An integration action's configSchema → the JSON Schema the model sees. */
function schemaFromConfig(configSchema = []) {
  const properties = {};
  const required = [];
  for (const field of configSchema) {
    const prop = { description: field.description || field.label || field.key };
    if (field.type === 'number') prop.type = 'number';
    else if (field.type === 'boolean') prop.type = 'boolean';
    else if (field.type === 'select') { prop.type = 'string'; prop.enum = (field.options || []).map((o) => o.value ?? o); }
    else if (field.type !== 'json') prop.type = 'string';
    properties[field.key] = prop;
    if (field.required) required.push(field.key);
  }
  return { type: 'object', properties, ...(required.length && { required }) };
}

/**
 * The agent's configured tools → descriptors the providers see. A tool that no
 * longer resolves (an MCP tool removed from its server, a deleted connection)
 * is dropped for this run with a log line rather than failing the node.
 */
async function resolveTools(ctx) {
  const refs = ctx.config.tools || [];
  if (refs.length > MAX_TOOLS) throw new PermanentFailure(`An agent can have at most ${MAX_TOOLS} tools (this one has ${refs.length})`);
  const { workspaceId } = ctx;
  const resolved = [];
  for (const ref of refs) {
    const { integration, action: actionId, connectionId = null } = ref || {};
    try {
      const manifest = IntegrationRegistry.get(integration);
      if (!manifest) throw new PermanentFailure(`Unknown integration: ${integration}`);
      let connection = null;
      let action = manifest.actions.find((a) => a.id === actionId);
      if (!action && typeof manifest.resolveAction === 'function') {
        connection = await IntegrationRegistry.resolveConnection(workspaceId, connectionId, integration);
        action = await manifest.resolveAction({ actionId, connection, workspaceId });
      } else if (connectionId) {
        connection = await IntegrationRegistry.resolveConnection(workspaceId, connectionId, integration);
      }
      if (!action) throw new PermanentFailure(`Unknown action: ${integration}.${actionId}`);
      resolved.push({ ref: { integration, action: actionId, connectionId }, action, connection, manifest });
    } catch (err) {
      if (!err?.permanent) throw err; // a transport hiccup: let the node retry/fail normally
      ctx.pushLog(`[agent] dropped tool ${integration}.${actionId}: ${err.message}`);
    }
  }

  // Names the model sees: `<connectionSlug>__<tool>` for MCP, `<integration>__<action>` otherwise.
  const slugCounts = new Map();
  for (const t of resolved) {
    if (t.manifest.resolveAction && t.connection) {
      const slug = slugify(t.connection.name);
      slugCounts.set(slug, (slugCounts.get(slug) || new Set()).add(String(t.connection.id)));
    }
  }
  const byName = new Map();
  for (const t of resolved) {
    let prefix = t.ref.integration;
    if (t.manifest.resolveAction && t.connection) {
      prefix = slugify(t.connection.name);
      if (slugCounts.get(prefix)?.size > 1) prefix = `${prefix}${String(t.connection.id).slice(-4)}`;
    }
    let name = toolName(`${prefix}__${t.ref.action}`);
    while (byName.has(name)) name = toolName(`${name}_`); // same tool listed twice
    t.name = name;
    t.inputSchema = t.action.inputSchema || schemaFromConfig(t.action.configSchema);
    if (t.inputSchema?.type !== 'object') t.inputSchema = { type: 'object', properties: {} };
    t.description = t.action.description || t.action.name || t.ref.action;
    t.redact = buildRedactor(secretStrings(t.connection));
    byName.set(name, t);
  }
  return byName;
}

function secretStrings(connection) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(connection?.credentials);
  return out;
}

function capForModel(output) {
  const text = typeof output === 'string' ? output : JSON.stringify(output ?? null);
  const max = env.agentToolResultMaxChars;
  return text.length > max ? `${text.slice(0, max)}\n[truncated: ${text.length - max} more characters]` : text;
}

function capStored(output) {
  const text = JSON.stringify(output ?? null);
  return text.length > STORED_OUTPUT_BYTES ? { truncated: true, preview: text.slice(0, 2000) } : output;
}

function forSocket(output) {
  const text = JSON.stringify(output ?? null);
  return text.length > SOCKET_OUTPUT_CHARS ? { truncated: true, preview: text.slice(0, SOCKET_OUTPUT_CHARS) } : output;
}

/** toolCalls live on the Run document, not in node:update (which would broadcast every output). */
function persistToolCalls(runId, nodeId, toolCalls, agentSteps) {
  return Run.updateOne(
    { _id: runId, 'nodeResults.nodeId': nodeId },
    { $set: { 'nodeResults.$.toolCalls': toolCalls, 'nodeResults.$.agentSteps': agentSteps } },
  );
}

/** Runs the loop for one agent node. Returns the executor result shape. */
export async function runAgentLoop(ctx) {
  const { config, node, run, workspaceId } = ctx;
  const runId = run.id;
  const nodeId = node.id;
  const provider = getAgentProvider();
  if (typeof provider.step !== 'function') throw new PermanentFailure('This agent provider does not support tools');

  const tools = await resolveTools(ctx);
  const sideEffecting = [...tools.values()].filter((t) => t.action.sideEffect);
  if (sideEffecting.length && !config.allowSideEffects) {
    throw new PermanentFailure(`Agent has side-effecting tools but side effects aren't allowed: ${sideEffecting.map((t) => t.name).join(', ')}`);
  }

  const toolList = [...tools.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  const state = { input: ctx.input, tools: toolList, history: [], forceFinal: false };
  const toolCalls = [];
  let agentSteps = 0;

  // One AbortController per node, tripped by the run's cancellation: in-flight
  // MCP calls get notifications/cancelled.
  const abort = new AbortController();
  Promise.resolve(ctx.signal?.cancelled).then(() => abort.abort(new RunCancelledError())).catch(() => {});

  const checkCancelled = () => {
    if (ctx.signal?.isCancelled?.()) throw new RunCancelledError();
  };
  const meta = { workspaceId };
  const turnAttempts = config.mockOverrides?.maxAttempts;

  const turn = async () => {
    checkCancelled();
    const { result } = await queue.enqueue(
      {
        payload: null,
        run: () => provider.step(config, state),
        onRetry: ({ attempt, maxAttempts, error, backoff }) =>
          ctx.pushLog(`[agent] turn ${agentSteps + 1}: ${error} (attempt ${attempt}/${maxAttempts}), retrying in ${backoff}ms...`),
      },
      { maxAttempts: turnAttempts, meta },
    );
    for (const line of result.logs || []) ctx.pushLog(line);
    return result;
  };

  const callTool = async (call, step) => {
    const descriptor = tools.get(call.tool);
    const callId = call.id || `${step}-${toolCalls.length + 1}`;
    const startedAt = new Date();
    const redact = descriptor?.redact || ((v) => v);
    const args = redact(call.args ?? {});
    const toolInfo = descriptor
      ? { integration: descriptor.ref.integration, action: descriptor.ref.action, connectionId: descriptor.ref.connectionId, name: descriptor.name }
      : { integration: null, action: null, connectionId: null, name: call.tool };
    emit(runId, 'agent:tool_call', { nodeId, step, callId, tool: toolInfo, args, status: 'started' });

    const record = { step, callId, tool: toolInfo, args, cached: false, attempts: 0, sandbox: false, startedAt };
    let modelResult;
    try {
      if (!descriptor) throw new PermanentFailure(`Unknown tool "${call.tool}" - pick one of: ${[...tools.keys()].join(', ')}`);
      if (call.args?.__invalid !== undefined) throw new PermanentFailure('Tool arguments were not valid JSON');
      checkCancelled();
      const { result, attempts } = await queue.enqueue(
        {
          payload: null,
          run: () => IntegrationRegistry.run({
            config: { integration: descriptor.ref.integration, action: descriptor.ref.action, connectionId: descriptor.ref.connectionId, params: call.args || {} },
            input: ctx.input,
            context: { ...ctx.toolContext, signal: abort.signal },
          }),
          onRetry: ({ attempt, maxAttempts, error, backoff }) =>
            ctx.pushLog(`[agent] ${descriptor.name}: ${error} (attempt ${attempt}/${maxAttempts}), retrying in ${backoff}ms...`),
        },
        { meta },
      );
      Object.assign(record, {
        status: 'success',
        output: capStored(result.output),
        cached: Boolean(result.cached),
        attempts,
        sandbox: result.mode === 'sandbox',
        durationMs: Date.now() - startedAt.getTime(),
      });
      modelResult = { id: call.id, tool: call.tool, args, output: result.output, content: capForModel(result.output), isError: false };
      ctx.pushLog(`[agent] step ${step} → ${descriptor.name}(${JSON.stringify(args).slice(0, 120)}) ✓ ${record.durationMs} ms${record.cached ? ' (cached)' : ''}`);
    } catch (err) {
      if (err?.cancelled) throw err;
      // A tool failure doesn't fail the node: the model gets the error as a
      // tool result and can recover or explain (spec/37 §5).
      const message = redact(String(err?.message || err));
      Object.assign(record, { status: 'failed', error: message, attempts: err?.attempts || 1, durationMs: Date.now() - startedAt.getTime() });
      modelResult = { id: call.id, tool: call.tool, args, output: null, content: message, isError: true };
      ctx.pushLog(`[agent] step ${step} → ${call.tool} ✗ ${message}`);
    }
    toolCalls.push(record);
    emit(runId, 'agent:tool_call', {
      nodeId, step, callId, tool: toolInfo, args,
      status: record.status,
      ...(record.status === 'success' ? { output: forSocket(record.output), cached: record.cached } : { error: record.error }),
      durationMs: record.durationMs,
    });
    return modelResult;
  };

  for (;;) {
    const result = await turn();

    if (result.type !== 'tool_calls') {
      if (ctx.signal?.isCancelled?.()) throw new RunCancelledError();
      await persistToolCalls(runId, nodeId, toolCalls, agentSteps);
      return {
        output: result.output,
        logs: [],
        handoffTarget: result.handoffTarget,
        patch: { agentSteps },
      };
    }
    if (state.forceFinal) throw new PermanentFailure(`Agent exceeded ${MAX_STEPS} tool-use steps`);

    agentSteps += 1;
    const step = agentSteps;
    // All of one turn's calls run in parallel; their results go back together.
    const results = await Promise.all((result.calls || []).map((call) => callTool(call, step)));
    await persistToolCalls(runId, nodeId, toolCalls, agentSteps);
    await ctx.updateResult({ agentSteps });

    // Results that arrive after a cancel are recorded, never fed back.
    checkCancelled();
    state.history.push({ raw: result.raw, calls: result.calls, results });
    if (agentSteps >= MAX_STEPS) state.forceFinal = true;
  }
}

/**
 * Save-time check (spec/37 acceptance: "can't be saved or run with a
 * side-effecting tool"). Resolves each agent's tools and returns the first
 * problem as a string, or null. Unresolvable tools are the validation panel's
 * business, not a save blocker.
 */
export async function validateAgentTools(workspaceId, nodes = []) {
  for (const node of nodes) {
    if (node?.type !== 'agent') continue;
    const cfg = node.data?.config || {};
    const refs = cfg.tools || [];
    if (!refs.length) continue;
    const label = cfg.label || node.id;
    if (refs.length > MAX_TOOLS) return `Agent "${label}" has more than ${MAX_TOOLS} tools`;
    if (cfg.allowSideEffects) continue;
    for (const ref of refs) {
      const manifest = IntegrationRegistry.get(ref?.integration);
      if (!manifest) continue;
      let action = manifest.actions.find((a) => a.id === ref.action);
      if (!action && typeof manifest.resolveAction === 'function') {
        try {
          const connection = await IntegrationRegistry.resolveConnection(workspaceId, ref.connectionId, ref.integration);
          action = await manifest.resolveAction({ actionId: ref.action, connection, workspaceId });
        } catch {
          continue;
        }
      }
      if (action?.sideEffect) return `Agent "${label}" has side-effecting tool ${ref.integration}.${ref.action} but side effects aren't allowed`;
    }
  }
  return null;
}
