import Run from '../models/Run.js';
import { evaluateCondition } from './conditionEval.js';
import { getAgentProvider } from '../config/agentProvider.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { queue } from '../queue/index.js';
import { PermanentFailure } from '../queue/errors.js';
import { toolCache, toolCacheKey } from '../cache/TTLCache.js';
import { getIo } from '../sockets/ioInstance.js';
import { env } from '../config/env.js';

/** In-flight runs, so a cancel request can reach the loop driving one. */
const activeRuns = new Map();

/** Returns false if the run isn't currently executing in this process. */
export function requestCancel(runId) {
  const control = activeRuns.get(runId);
  if (!control) return false;
  // First reason wins. A run already winding down keeps the label it was given.
  if (!control.cancelled) {
    control.cancelled = true;
    control.reason = 'user';
  }
  return true;
}

function emit(runId, event, payload) {
  try {
    getIo().to(`run:${runId}`).emit(event, { runId, ...payload });
  } catch {
    // socket layer not initialized (e.g. in a script/test context) - safe to ignore
  }
}

/** Edges are client-generated and carry an id, but don't depend on it being there. */
function edgeKey(edge) {
  return edge.id || `${edge.source}->${edge.target}:${edge.sourceHandle || ''}:${edge.label || ''}`;
}

async function updateNodeResult(runId, nodeId, patch) {
  const $set = {};
  for (const [key, value] of Object.entries(patch)) $set[`nodeResults.$.${key}`] = value;
  // Atomic positional update rather than doc.save(): with nodes now running in
  // parallel, concurrent saves of one Run document would race (and Mongoose
  // rejects parallel saves of the same doc outright).
  await Run.updateOne({ _id: runId, 'nodeResults.nodeId': nodeId }, { $set });
  emit(runId, 'node:update', { nodeId, ...patch });
}

async function executeAgentOrTool(node, input) {
  if (node.type === 'agent') {
    return getAgentProvider().run(node.data.config, input);
  }

  if (node.type === 'tool') {
    const config = node.data?.config || {};
    const { toolType } = config;
    const handler = ToolRegistry.get(toolType);
    // A config error, not flakiness - retrying it three times is pure waste.
    if (!handler) throw new PermanentFailure(`Unknown tool type: ${toolType}`);

    // Deliberate cache exception: a node with failure injection dialed up must
    // actually be allowed to fail. Serving it from cache would bypass both the
    // injected failure and the retry path the feature exists to demonstrate.
    const failureRate = Number(config.mockOverrides?.failureRate) || 0;
    const cacheable = failureRate <= 0;
    const key = toolCacheKey(toolType, input);

    if (cacheable) {
      const cached = toolCache.get(key);
      if (cached !== undefined) return { ...cached, cached: true };
    }

    const result = await handler.run(config, input);
    if (cacheable) toolCache.set(key, result);
    return result;
  }

  throw new PermanentFailure(`Node type ${node.type} has no executable behavior`);
}

export async function executeRun(runId, workflow) {
  const nodes = workflow.nodes || [];
  const edges = (workflow.edges || []).filter((e) => e.source && e.target);
  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  await Run.updateOne(
    { _id: runId },
    {
      $set: {
        status: 'running',
        startedAt: new Date(),
        cancelReason: null,
        nodeResults: nodes.map((n) => ({ nodeId: n.id, status: 'pending', logs: [] })),
      },
    },
  );
  const startedAt = new Date();
  emit(runId, 'run:started', { startedAt });

  const control = { cancelled: false, reason: null };
  activeRuns.set(runId, control);
  const timeoutHandle = setTimeout(() => {
    // Don't relabel a run the user already cancelled: in-flight nodes can still
    // be draining when the deadline passes, and 'cancelled' must not become
    // 'failed/timeout' just because that drain took a moment.
    if (control.cancelled) return;
    control.cancelled = true;
    control.reason = 'timeout';
  }, env.runTimeoutMs);

  const outputs = new Map();
  const resolved = new Map(); // nodeId -> 'success' | 'failed' | 'skipped'
  const pruned = new Set(); // edge keys ruled out by a condition or handoff
  const inFlight = new Map();
  let runFailed = false;

  // Edges pointing at nodes that aren't in the graph can never resolve; ignoring
  // them keeps a stale edge from deadlocking the whole run.
  const incomingFor = (nodeId) => edges.filter((e) => e.target === nodeId && nodesById.has(e.source));
  const outgoingFor = (nodeId) => edges.filter((e) => e.source === nodeId && nodesById.has(e.target));

  function liveIncoming(nodeId) {
    return incomingFor(nodeId).filter(
      (e) => !pruned.has(edgeKey(e)) && resolved.get(e.source) === 'success',
    );
  }

  function readyNodes() {
    return nodes
      .filter((n) => !resolved.has(n.id) && !inFlight.has(n.id))
      .filter((n) => incomingFor(n.id).every((e) => resolved.has(e.source)))
      .map((n) => n.id);
  }

  function buildInput(live) {
    if (!live.length) return null;
    if (live.length === 1) return outputs.get(live[0].source);
    // Keyed by source id, not positional: array indices shift when a branch is
    // skipped, and a bare array gives a condition expression nothing to name.
    return Object.fromEntries(live.map((e) => [e.source, outputs.get(e.source)]));
  }

  /** Never throws - a node failure is a result, not an exception, to the scheduler. */
  async function runNode(node) {
    const nodeId = node.id;
    const incoming = incomingFor(nodeId);
    const live = liveIncoming(nodeId);

    // Skipped only when EVERY inbound path is dead. One dead branch of a
    // fan-in must not skip the join.
    if (incoming.length > 0 && live.length === 0) {
      await updateNodeResult(runId, nodeId, { status: 'skipped' });
      return { status: 'skipped' };
    }

    const input = buildInput(live);
    const begunAt = Date.now();
    await updateNodeResult(runId, nodeId, { status: 'running', startedAt: new Date() });

    const logs = [];
    const pushLog = (line) => {
      logs.push(line);
      emit(runId, 'node:log', { nodeId, line });
    };

    const finish = async (patch) => {
      await updateNodeResult(runId, nodeId, {
        finishedAt: new Date(),
        durationMs: Date.now() - begunAt,
        logs,
        ...patch,
      });
    };

    try {
      if (node.type === 'start') {
        outputs.set(nodeId, null);
        await finish({ status: 'success' });
        return { status: 'success' };
      }

      if (node.type === 'end') {
        outputs.set(nodeId, input);
        // Persist it: the end node's input IS the workflow's final result, and
        // dropping it leaves the run detail view with nothing to show for it.
        await finish({ status: 'success', output: input });
        return { status: 'success' };
      }

      if (node.type === 'condition') {
        const taken = evaluateCondition(node.data.config.expression, input);
        const takenHandle = taken ? 'true' : 'false';
        outputs.set(nodeId, input);
        pushLog(`[condition] "${node.data.config.expression}" evaluated to ${taken}`);
        for (const edge of outgoingFor(nodeId)) {
          if (edge.sourceHandle !== takenHandle) pruned.add(edgeKey(edge));
        }
        await finish({ status: 'success', output: { taken }, attempts: 1 });
        return { status: 'success' };
      }

      const { result, attempts } = await queue.enqueue(
        {
          payload: null,
          run: () => executeAgentOrTool(node, input),
          onRetry: ({ attempt, maxAttempts, error, backoff }) =>
            pushLog(`${error} (attempt ${attempt}/${maxAttempts}), retrying in ${backoff}ms...`),
        },
        { maxAttempts: node.data?.config?.mockOverrides?.maxAttempts },
      );

      for (const line of result.logs || []) pushLog(line);
      outputs.set(nodeId, result.output);

      const patch = {
        status: 'success',
        output: result.output,
        cached: Boolean(result.cached),
        attempts,
      };

      if (node.data?.config?.isHandoff) {
        const outgoing = outgoingFor(nodeId);
        const target = result.handoffTarget;
        const validTargets = new Set(outgoing.map((e) => e.label));
        if (!target || !validTargets.has(target)) {
          throw new PermanentFailure(`Agent selected unknown handoff target: ${target}`);
        }
        for (const edge of outgoing) {
          if (edge.label !== target) pruned.add(edgeKey(edge));
        }
        patch.handoffTarget = target;
        pushLog(`[handoff] routing to "${target}"`);
      }

      await finish(patch);
      return { status: 'success' };
    } catch (err) {
      pushLog(String(err.message || err));
      await finish({ status: 'failed', attempts: err.attempts || 1 });
      return { status: 'failed' };
    }
  }

  try {
    for (;;) {
      if (control.cancelled) break;

      for (const nodeId of readyNodes()) {
        const promise = runNode(nodesById.get(nodeId))
          .then(({ status }) => {
            resolved.set(nodeId, status);
            if (status === 'failed') runFailed = true;
          })
          .finally(() => inFlight.delete(nodeId));
        inFlight.set(nodeId, promise);
      }

      if (!inFlight.size) break;
      await Promise.race(inFlight.values());
    }

    // Let whatever is mid-flight finish: mock handlers are short, and their real
    // results are more useful than throwing them away.
    if (inFlight.size) await Promise.allSettled([...inFlight.values()]);

    const unresolved = nodes.filter((n) => !resolved.has(n.id));

    if (control.cancelled) {
      for (const node of unresolved) {
        await updateNodeResult(runId, node.id, { status: 'skipped' });
        resolved.set(node.id, 'skipped');
      }
    } else if (unresolved.length) {
      // Nothing ready and nothing running, yet nodes remain - they're in a cycle.
      // Fail them loudly rather than leaving them 'pending' forever.
      runFailed = true;
      for (const node of unresolved) {
        await updateNodeResult(runId, node.id, {
          status: 'failed',
          logs: ['graph contains a cycle or unreachable nodes - node never became runnable'],
          finishedAt: new Date(),
        });
        resolved.set(node.id, 'failed');
      }
    }
  } finally {
    clearTimeout(timeoutHandle);
    activeRuns.delete(runId);
  }

  const cancelledByUser = control.cancelled && control.reason === 'user';
  const status = cancelledByUser ? 'cancelled' : runFailed || control.cancelled ? 'failed' : 'success';
  const finishedAt = new Date();

  await Run.updateOne(
    { _id: runId },
    { $set: { status, finishedAt, cancelReason: control.cancelled ? control.reason : null } },
  );

  if (control.cancelled) {
    emit(runId, 'run:cancelled', { status, cancelReason: control.reason, finishedAt });
  }
  emit(runId, 'run:completed', { status, finishedAt });

  return Run.findById(runId);
}
