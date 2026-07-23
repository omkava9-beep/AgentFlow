import Run from '../models/Run.js';
import { topologicalOrder } from './topologicalOrder.js';
import { evaluateCondition } from './conditionEval.js';
import { getAgentProvider } from '../config/agentProvider.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { queue } from '../queue/index.js';
import { toolCache, toolCacheKey } from '../cache/TTLCache.js';
import { getIo } from '../sockets/ioInstance.js';

const RUN_TIMEOUT_MS = 2 * 60 * 1000;

function emit(runId, event, payload) {
  try {
    getIo().to(`run:${runId}`).emit(event, { runId, ...payload });
  } catch {
    // socket layer not initialized (e.g. in a script/test context) - safe to ignore
  }
}

function byId(nodes) {
  return new Map(nodes.map((n) => [n.id, n]));
}

function incomingEdgesFor(edges, nodeId) {
  return edges.filter((e) => e.target === nodeId);
}

function outgoingEdgesFor(edges, nodeId) {
  return edges.filter((e) => e.source === nodeId);
}

async function runNodeResult(run, nodeId) {
  return run.nodeResults.find((r) => r.nodeId === nodeId);
}

async function updateNodeResult(run, nodeId, patch) {
  const result = await runNodeResult(run, nodeId);
  Object.assign(result, patch);
  await run.save();
  emit(run._id.toString(), 'node:update', { nodeId, ...patch });
}

async function executeAgentOrTool(node, input) {
  if (node.type === 'agent') {
    const provider = getAgentProvider();
    return provider.run(node.data.config, input);
  }
  if (node.type === 'tool') {
    const { toolType } = node.data.config;
    const handler = ToolRegistry.get(toolType);
    if (!handler) throw new Error(`Unknown tool type: ${toolType}`);

    const key = toolCacheKey(toolType, input);
    const cached = toolCache.get(key);
    if (cached !== undefined) {
      return { ...cached, cached: true };
    }
    const result = await handler.run(node.data.config, input);
    toolCache.set(key, result);
    return result;
  }
  throw new Error(`Node type ${node.type} has no executable behavior`);
}

export async function executeRun(runId, workflow) {
  const run = await Run.findById(runId);
  run.status = 'running';
  run.startedAt = new Date();
  run.nodeResults = workflow.nodes.map((n) => ({ nodeId: n.id, status: 'pending', logs: [] }));
  await run.save();
  emit(runId, 'run:started', { startedAt: run.startedAt });

  const nodesById = byId(workflow.nodes);
  const order = topologicalOrder(workflow.nodes, workflow.edges);
  const outputs = new Map();
  const skipped = new Set();
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let runFailed = false;

  for (const nodeId of order) {
    if (Date.now() > deadline) break;
    if (skipped.has(nodeId)) {
      await updateNodeResult(run, nodeId, { status: 'skipped' });
      for (const edge of outgoingEdgesFor(workflow.edges, nodeId)) skipped.add(edge.target);
      continue;
    }

    const node = nodesById.get(nodeId);
    const incoming = incomingEdgesFor(workflow.edges, nodeId);
    const input = incoming.length === 1 ? outputs.get(incoming[0].source) : incoming.map((e) => outputs.get(e.source));

    await updateNodeResult(run, nodeId, { status: 'running', startedAt: new Date() });
    const startedAt = Date.now();

    try {
      if (node.type === 'start') {
        outputs.set(nodeId, null);
        await updateNodeResult(run, nodeId, { status: 'success', finishedAt: new Date(), durationMs: Date.now() - startedAt });
        continue;
      }
      if (node.type === 'end') {
        outputs.set(nodeId, input);
        await updateNodeResult(run, nodeId, { status: 'success', finishedAt: new Date(), durationMs: Date.now() - startedAt });
        continue;
      }
      if (node.type === 'condition') {
        const taken = evaluateCondition(node.data.config.expression, input);
        outputs.set(nodeId, input);
        await updateNodeResult(run, nodeId, {
          status: 'success',
          output: { taken },
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
        });
        const outgoing = outgoingEdgesFor(workflow.edges, nodeId);
        const takenHandle = taken ? 'true' : 'false';
        for (const edge of outgoing) {
          if (edge.sourceHandle !== takenHandle) skipped.add(edge.target);
        }
        continue;
      }

      // agent / tool nodes go through the job queue
      const result = await queue.enqueue({
        payload: null,
        run: () => executeAgentOrTool(node, input),
      });

      outputs.set(nodeId, result.output);

      if (node.data.config?.isHandoff) {
        const outgoing = outgoingEdgesFor(workflow.edges, nodeId);
        const target = result.handoffTarget;
        const validTargets = new Set(outgoing.map((e) => e.label));
        if (!target || !validTargets.has(target)) {
          throw new Error(`Agent selected unknown handoff target: ${target}`);
        }
        for (const edge of outgoing) {
          if (edge.label !== target) skipped.add(edge.target);
        }
      }

      await updateNodeResult(run, nodeId, {
        status: 'success',
        output: result.output,
        logs: result.logs || [],
        cached: Boolean(result.cached),
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      runFailed = true;
      await updateNodeResult(run, nodeId, {
        status: 'failed',
        logs: [String(err.message || err)],
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
      });
      // everything only reachable through this node is skipped
      for (const edge of outgoingEdgesFor(workflow.edges, nodeId)) {
        skipped.add(edge.target);
      }
    }
  }

  run.status = runFailed ? 'failed' : 'success';
  run.finishedAt = new Date();
  await run.save();
  emit(runId, 'run:completed', { status: run.status, finishedAt: run.finishedAt });
  return run;
}
