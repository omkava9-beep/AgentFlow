import Run from '../models/Run.js';
import { queue } from '../queue/index.js';
import { PermanentFailure } from '../queue/errors.js';
import { getIo } from '../sockets/ioInstance.js';
import { env } from '../config/env.js';
import { executorFor, kindOf, supportsErrorHandle } from './nodes/index.js';
import { RunCancelledError } from './nodes/shared.js';
import { armWait, clearWait, clearWaitsForRun } from './waitTimers.js';
import { withRunLock } from './runLocks.js';

/** Start and End can't be switched off: a run needs a beginning and a result. */
function isDisabledNode(node) {
  return Boolean(node?.data?.config?.disabled) && node.type !== 'start' && node.type !== 'end';
}

/** A persisted node result that was a disabled pass-through (see runNode). */
function isDisabledPassThrough(result) {
  return result?.status === 'skipped' && result?.skipReason === 'disabled';
}

/**
 * Which outgoing edges a disabled node still feeds. It has no decision to make,
 * so multi-output nodes follow their "positive" branch: a condition its `true`
 * handle, an approval `approved`, a handoff agent its first candidate. Error
 * edges never fire - nothing failed.
 */
function isPrimaryEdge(node, edge) {
  if (edge.sourceHandle === 'error') return false;
  if (node.type === 'condition') return edge.sourceHandle === 'true';
  if (node.type === 'approval') return edge.sourceHandle === 'approved';
  const config = node.data?.config || {};
  if (node.type === 'agent' && config.isHandoff) {
    const first = (config.candidates || [])[0];
    return first ? edge.label === first : true;
  }
  return true;
}

/** In-flight runs, so a cancel request can reach the loop driving one. */
const activeRuns = new Map();
/**
 * Runs that have left the loop to park but haven't written `waiting` yet
 * (spec/32 §3). A resume that arrives in that window waits for the write
 * instead of finding a run that is neither active nor parked.
 */
const parkingRuns = new Map();
/** Callers waiting for a run to reach a terminal status - a loop's parked child, say. */
const terminalWaiters = new Map();

const TERMINAL = ['success', 'failed', 'cancelled'];

/** Whether this process is currently driving the run. */
export function isRunActive(runId) {
  return activeRuns.has(String(runId));
}

/**
 * Hands a decision for a waiting node to the engine that's driving the run
 * right now (spec/32 §3: while other branches run, the run stays `running` and
 * only the node waits). Returns false when the run isn't active here.
 */
export function deliverResolution(runId, resolution) {
  const control = activeRuns.get(String(runId));
  if (!control) return false;
  control.resolutions.push(resolution);
  control.wake?.();
  return true;
}

/** Resolves once the run has parked (if it was in the middle of parking). */
export function parked(runId) {
  return parkingRuns.get(String(runId)) || Promise.resolve();
}

/** The finished Run document, whenever that happens - immediately if it already has. */
export async function awaitRunTerminal(runId) {
  const id = String(runId);
  const current = await Run.findById(id);
  if (!current || TERMINAL.includes(current.status)) return current;
  return new Promise((resolve) => {
    const list = terminalWaiters.get(id) || [];
    list.push(resolve);
    terminalWaiters.set(id, list);
  });
}

function settleTerminal(runId, runDoc) {
  const id = String(runId);
  const list = terminalWaiters.get(id);
  if (!list) return;
  terminalWaiters.delete(id);
  for (const resolve of list) resolve(runDoc);
}

/**
 * First reason wins: a run already winding down keeps the label it was given.
 * Cancelling a run cascades to every child it started (spec/31 §6), and wakes
 * any orchestration node waiting on the run's cancellation promise.
 */
function cancelControl(control, reason) {
  if (control.cancelled) return;
  control.cancelled = true;
  control.reason = reason;
  control.resolveCancelled();
  for (const childId of control.children) {
    const child = activeRuns.get(childId);
    // Descendants end `cancelled`, whatever stopped the parent. A child that
    // parked on an approval isn't in activeRuns - cancel it in the database.
    if (child) cancelControl(child, 'user');
    else cancelWaitingRun(childId).catch((err) => console.error(`cancel of parked child ${childId} failed:`, err));
  }
}

/** Returns false if the run isn't currently executing in this process. */
export function requestCancel(runId) {
  const control = activeRuns.get(String(runId));
  if (!control) return false;
  cancelControl(control, 'user');
  return true;
}

function emit(runId, event, payload) {
  try {
    getIo().to(`run:${runId}`).emit(event, { runId, ...payload });
  } catch {
    // socket layer not initialized (e.g. in a script/test context) - safe to ignore
  }
}

function emitToWorkspaceRoom(workspaceId, event, payload) {
  try {
    if (workspaceId) getIo().to(`workspace:${workspaceId}`).emit(event, payload);
  } catch {
    // no socket layer in scripts
  }
}

/**
 * spec/35 §5: every run status transition, to the workspace room, so the
 * Runs page, run history and analytics update live. Emitted from the same
 * places as run:started / run:waiting / run:completed, so it can't drift.
 */
export function emitRunStatusChanged(run) {
  if (!run) return;
  emitToWorkspaceRoom(String(run.workspaceId), 'run:status_changed', {
    runId: String(run._id || run.runId),
    workflowId: String(run.workflowId),
    status: run.status,
    trigger: run.trigger || 'manual',
    createdAt: run.createdAt || null,
    finishedAt: run.finishedAt || null,
    parentRunId: run.parentRunId ? String(run.parentRunId) : null,
  });
}

// spec/35 §6: the attempts log is capped so a node with a huge maxAttempts
// can't grow the run document without bound.
const MAX_ATTEMPT_LOG = 20;

/** Appends one attempt to the node's log and streams it as `node:attempt`. */
async function recordAttempt(runId, nodeId, info) {
  if (info.attempt > MAX_ATTEMPT_LOG) return;
  const entry = {
    attempt: info.attempt,
    startedAt: info.startedAt,
    finishedAt: info.finishedAt,
    durationMs: info.durationMs,
    outcome: info.outcome,
    error: info.error ?? null,
    backoffMs: info.backoffMs ?? null,
    cached: Boolean(info.result?.cached),
    // The last kept entry says more attempts followed that aren't listed.
    truncated: info.attempt === MAX_ATTEMPT_LOG && info.backoffMs != null,
  };
  await Run.updateOne({ _id: runId, 'nodeResults.nodeId': nodeId }, { $push: { 'nodeResults.$.attemptsLog': entry } });
  emit(runId, 'node:attempt', { nodeId, entry });
}

/** Edges are client-generated and carry an id, but don't depend on it being there. */
export function edgeKey(edge) {
  return edge.id || `${edge.source}->${edge.target}:${edge.sourceHandle || ''}:${edge.label || ''}`;
}

/**
 * Node ids become keys under `engineState.outputs`, and MongoDB field names
 * can't contain dots or start with `$`. Percent-encode just those.
 */
export function stateKey(nodeId) {
  return String(nodeId).replace(/%/g, '%25').replace(/\./g, '%2E').replace(/^\$/, '%24');
}
export function fromStateKey(key) {
  return String(key).replace(/%24/g, '$').replace(/%2E/g, '.').replace(/%25/g, '%');
}

// spec/32 edge cases: a stored output is capped so a run stays well under
// MongoDB's 16 MB document limit even with engineState mirroring outputs.
const MAX_STORED_OUTPUT_BYTES = 1024 * 1024;
function capped(value) {
  try {
    const size = Buffer.byteLength(JSON.stringify(value ?? null));
    return size > MAX_STORED_OUTPUT_BYTES ? { truncated: true, bytes: size } : value;
  } catch {
    return { truncated: true, unserializable: true };
  }
}

/**
 * `state` carries the engine's downstream-facing output and the edges the node
 * pruned, written in the SAME update as the result (spec/32 §3) - one write,
 * so the result and the rehydration state can never disagree.
 */
async function updateNodeResult(runId, nodeId, patch, state = null) {
  const $set = {};
  for (const [key, value] of Object.entries(patch)) $set[`nodeResults.$.${key}`] = value;
  const update = { $set };
  if (state && 'output' in state) $set[`engineState.outputs.${stateKey(nodeId)}`] = capped(state.output);
  if (state?.pruned?.length) update.$addToSet = { 'engineState.pruned': { $each: state.pruned } };
  // Atomic positional update rather than doc.save(): with nodes now running in
  // parallel, concurrent saves of one Run document would race (and Mongoose
  // rejects parallel saves of the same doc outright).
  await Run.updateOne({ _id: runId, 'nodeResults.nodeId': nodeId }, update);
  emit(runId, 'node:update', { nodeId, ...patch });
}

/**
 * `timeoutMs` overrides the env-wide run deadline for this run only - the
 * deadline is otherwise process-global, which makes it impossible to exercise
 * the timeout path without also starving every other run in the process.
 *
 * Resolves with the Run document when the run finishes OR parks (spec/32 §3):
 * a parked run comes back with `status: 'waiting'`.
 */
export function executeRun(runId, workflow, { timeoutMs = env.runTimeoutMs, input = null, seed = null } = {}) {
  return runEngine(String(runId), workflow, { timeoutMs, input, seed });
}

/**
 * Re-enters the engine for a parked run (spec/32 §4). `runDoc` is the claimed
 * Run (already `running`), `workflow` its pinned graph, and `resolutions` the
 * decision(s) that woke it: `[{ nodeId, resolution }]`.
 */
export function resumeEngine(runId, workflow, { runDoc, resolutions }) {
  return runEngine(String(runId), workflow, { resume: { runDoc, resolutions } });
}

/**
 * `seed` (spec/35 §2) starts a retry-from-failed: `results` are the original
 * run's node results to reuse (copied, marked `reused`, never executed), and
 * `outputs` / `pruned` the matching slice of its engine state, so upstream
 * routing decisions stand and only the retried region runs.
 */
async function runEngine(runId, workflow, { timeoutMs = env.runTimeoutMs, input: runInputArg = null, resume = null, seed = null }) {
  // Registered before the first await, so a parent that starts this run as a
  // child can cancel it the moment createAndStartRun returns its id, and a
  // decision that races the start still reaches it.
  let resolveCancelled;
  const control = {
    cancelled: false,
    reason: null,
    children: new Set(),
    cancelledPromise: new Promise((resolve) => { resolveCancelled = resolve; }),
    deadlineAt: 0,
    resolutions: resume ? [...resume.resolutions] : [],
    wake: null,
  };
  control.resolveCancelled = resolveCancelled;
  activeRuns.set(runId, control);

  const nodes = workflow.nodes || [];
  const edges = (workflow.edges || []).filter((e) => e.source && e.target);
  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  const outputs = new Map();
  // nodeId -> 'success' | 'failed' | 'skipped' | 'handled' (a failure routed
  // down the node's error edge, spec/31 §7).
  const resolved = new Map();
  const arrival = new Map(); // nodeId -> order it resolved in, for `first` merges
  const pruned = new Set(); // edge keys ruled out by a condition, handoff or error routing
  const waitingNodes = new Map(); // nodeId -> { nodeId, reason, since, resumeAt } (spec/32)
  const inFlight = new Map();
  let runFailed = false;
  let order = 0;
  let activeMsBefore = 0;

  let runDoc;
  if (resume) {
    runDoc = resume.runDoc;
    // Rebuild from MongoDB (spec/32 §4 step 3): resolved from terminal node
    // results, outputs and pruned edges from engineState.
    const results = [...(runDoc.nodeResults || [])]
      .sort((a, b) => new Date(a.finishedAt || 0) - new Date(b.finishedAt || 0));
    for (const r of results) {
      if (r.status === 'success' || isDisabledPassThrough(r)) resolved.set(r.nodeId, 'success');
      else if (r.status === 'skipped') resolved.set(r.nodeId, 'skipped');
      else if (r.status === 'failed') {
        resolved.set(r.nodeId, r.handled ? 'handled' : 'failed');
        if (!r.handled) runFailed = true;
      } else if (r.status === 'waiting') {
        waitingNodes.set(r.nodeId, { nodeId: r.nodeId, reason: r.approval ? 'approval' : 'delay', since: r.waitingSince, resumeAt: r.resumeAt });
      }
      if (resolved.has(r.nodeId)) arrival.set(r.nodeId, order++);
    }
    const state = runDoc.engineState || {};
    const storedOutputs = state.outputs instanceof Map ? Object.fromEntries(state.outputs) : (state.outputs || {});
    for (const [key, value] of Object.entries(storedOutputs)) outputs.set(fromStateKey(key), value);
    for (const key of state.pruned || []) pruned.add(key);
    activeMsBefore = state.activeMs || 0;
  } else {
    const reusedById = new Map((seed?.results || []).map((r) => [r.nodeId, { ...r, reused: true }]));
    const seededOutputs = {};
    for (const [nodeId, value] of Object.entries(seed?.outputs || {})) {
      if (!reusedById.has(nodeId)) continue;
      seededOutputs[stateKey(nodeId)] = capped(value);
      outputs.set(nodeId, value);
    }
    for (const key of seed?.pruned || []) pruned.add(key);
    // Reused nodes count as already resolved, in the order they finished.
    const reusedInOrder = [...reusedById.values()].sort((a, b) => new Date(a.finishedAt || 0) - new Date(b.finishedAt || 0));
    for (const r of reusedInOrder) {
      if (r.status === 'success' || isDisabledPassThrough(r)) resolved.set(r.nodeId, 'success');
      else if (r.status === 'skipped') resolved.set(r.nodeId, 'skipped');
      else if (r.status === 'failed') resolved.set(r.nodeId, r.handled ? 'handled' : 'failed');
      if (resolved.has(r.nodeId)) arrival.set(r.nodeId, order++);
    }
    runDoc = await Run.findOneAndUpdate(
      { _id: runId },
      {
        $set: {
          status: 'running',
          startedAt: new Date(),
          cancelReason: null,
          failReason: null,
          waiting: [],
          engineState: { outputs: seededOutputs, pruned: [...pruned], activeMs: 0 },
          nodeResults: nodes.map((n) => reusedById.get(n.id) || { nodeId: n.id, status: 'pending', logs: [] }),
        },
      },
      { returnDocument: 'after', projection: { trigger: 1, depth: 1, rootRunId: 1, input: 1, triggeredBy: 1, createdAt: 1, parentRunId: 1 } },
    );
  }

  const runMeta = {
    id: runId,
    trigger: runDoc?.trigger || 'manual',
    input: resume ? runDoc?.input ?? null : runInputArg,
    depth: runDoc?.depth || 0,
    rootRunId: runDoc?.rootRunId ? String(runDoc.rootRunId) : runId,
    workflowId: workflow._id,
    workflowName: workflow.name,
    workspaceId: workflow.workspaceId,
    triggeredBy: runDoc?.triggeredBy ? String(runDoc.triggeredBy) : null,
  };

  // Waiting time never counts toward the deadline (spec/32 §5): a resumed run
  // gets whatever active budget it had left.
  const budget = resume ? Math.max(1, env.runTimeoutMs - activeMsBefore) : timeoutMs;
  control.deadlineAt = Date.now() + budget;
  const activeSince = Date.now();
  if (!resume) emit(runId, 'run:started', { startedAt: new Date() });
  // Both a fresh start and a resume are the run entering `running`.
  const statusBase = {
    _id: runId,
    workspaceId: workflow.workspaceId,
    workflowId: workflow._id,
    trigger: runMeta.trigger,
    createdAt: runDoc?.createdAt || null,
    parentRunId: runDoc?.parentRunId || null,
  };
  emitRunStatusChanged({ ...statusBase, status: 'running' });

  const timeoutHandle = setTimeout(() => {
    // Don't relabel a run the user already cancelled: in-flight nodes can still
    // be draining when the deadline passes, and 'cancelled' must not become
    // 'failed/timeout' just because that drain took a moment.
    cancelControl(control, 'timeout');
  }, budget);

  // Handed to tool handlers so a side-effecting tool can attribute its writes.
  const toolContext = { runId, workflowId: workflow._id, workspaceId: workflow.workspaceId };
  const signal = { cancelled: control.cancelledPromise, isCancelled: () => control.cancelled };

  // Edges pointing at nodes that aren't in the graph can never resolve; ignoring
  // them keeps a stale edge from deadlocking the whole run.
  const incomingFor = (nodeId) => edges.filter((e) => e.target === nodeId && nodesById.has(e.source));
  const outgoingFor = (nodeId) => edges.filter((e) => e.source === nodeId && nodesById.has(e.target));
  const isPruned = (edge) => pruned.has(edgeKey(edge));
  const labelOf = (nodeId) => nodesById.get(nodeId)?.data?.config?.label || nodeId;

  /**
   * spec/19's live-edge rule, extended by spec/31 §7: live when not pruned and
   * either the source succeeded and this isn't its error handle, or the source
   * failed-but-handled and this IS its error handle.
   */
  function isLive(edge) {
    if (isPruned(edge)) return false;
    const status = resolved.get(edge.source);
    if (edge.sourceHandle === 'error') return status === 'handled';
    return status === 'success';
  }

  const liveIncoming = (nodeId) => incomingFor(nodeId).filter(isLive);

  function readyNodes() {
    return nodes
      .filter((n) => !resolved.has(n.id) && !inFlight.has(n.id) && !waitingNodes.has(n.id))
      // A node claimed by a decision is resolved via its resolution, not rerun.
      .filter((n) => !control.resolutions.some((r) => r.nodeId === n.id))
      .filter((n) => {
        const incoming = incomingFor(n.id);
        const executor = executorFor(n.type);
        if (executor?.isReady) {
          return executor.isReady(n, { incoming, isResolved: (id) => resolved.has(id), isLive });
        }
        return incoming.every((e) => resolved.has(e.source));
      })
      .map((n) => n.id);
  }

  function buildInput(live) {
    if (!live.length) return null;
    if (live.length === 1) return outputs.get(live[0].source);
    // Keyed by source id, not positional: array indices shift when a branch is
    // skipped, and a bare array gives a condition expression nothing to name.
    return Object.fromEntries(live.map((e) => [e.source, outputs.get(e.source)]));
  }

  /**
   * Starts another workflow as a child of this run (spec/31 §6) and resolves
   * when it finishes. Goes through createAndStartRun like every run does, with
   * the lineage set: children skip the "already running" guard and the daily
   * quota, and inherit whatever is left of this run's deadline.
   */
  async function startChildRun(nodeId, childIds, childWorkflow, { input, iteration = null } = {}) {
    if (control.cancelled) throw new RunCancelledError();
    const depth = runMeta.depth + 1;
    if (depth > env.subworkflowMaxDepth) {
      throw new PermanentFailure(`sub-workflow depth limit (${env.subworkflowMaxDepth}) reached`);
    }
    // Imported lazily: runService imports this module, so a static import would
    // be a cycle evaluated at load time.
    const { createAndStartRun, SKIP_REASONS } = await import('../services/runService.js');
    const remaining = control.deadlineAt - Date.now();
    const started = await createAndStartRun(childWorkflow, {
      trigger: 'subworkflow',
      input,
      skipQuota: true,
      timeoutMs: Math.max(1, Math.min(env.runTimeoutMs, remaining)),
      parent: { runId, nodeId, rootRunId: runMeta.rootRunId, depth, iteration },
    });
    if (!started.ok) {
      throw new PermanentFailure(started.reason === SKIP_REASONS.NOT_RUNNABLE
        ? `"${childWorkflow.name}" has no Start node`
        : `"${childWorkflow.name}" could not start (${started.reason})`);
    }
    control.children.add(started.runId);
    childIds.push(started.runId);
    await updateNodeResult(runId, nodeId, { childRunIds: [...childIds] });
    // A cancel that landed while the child was being created still reaches it.
    if (control.cancelled) requestCancel(started.runId);
    let run = await started.done;
    // A child that parked on an approval (spec/32) isn't finished: the parent
    // keeps waiting - inline, holding no queue slot - until it really is.
    if (run?.status === 'waiting') run = await awaitRunTerminal(started.runId);
    control.children.delete(started.runId);
    return { runId: started.runId, run };
  }

  function nodeContext(node, extra) {
    const nodeId = node.id;
    return {
      node,
      config: node.data?.config || {},
      outgoing: outgoingFor(nodeId),
      outputOf: (id) => outputs.get(id),
      isPruned,
      labelOf,
      run: runMeta,
      workspaceId: workflow.workspaceId,
      toolContext,
      signal,
      updateResult: (patch) => updateNodeResult(runId, nodeId, patch),
      ...extra,
    };
  }

  /** Never throws - a node failure is a result, not an exception, to the scheduler. */
  async function runNode(node) {
    const nodeId = node.id;
    const executor = executorFor(node.type);
    const incoming = incomingFor(nodeId);
    const live = liveIncoming(nodeId);

    // Skipped only when EVERY inbound path is dead. One dead branch of a
    // fan-in must not skip the join.
    if (incoming.length > 0 && live.length === 0) {
      await updateNodeResult(runId, nodeId, { status: 'skipped' });
      return { status: 'skipped' };
    }

    const input = buildInput(live);

    // A node switched off in the builder (n8n-style "disable") doesn't execute:
    // its input becomes its output and the flow carries on. Recorded as skipped
    // with skipReason 'disabled' so the monitor can say so, but it counts as a
    // success for the edges leaving it - otherwise everything downstream would
    // be skipped too, which is exactly what disabling a step is meant to avoid.
    if (isDisabledNode(node)) {
      const prunedHere = [];
      for (const edge of outgoingFor(nodeId)) {
        if (isPrimaryEdge(node, edge)) continue;
        const key = edgeKey(edge);
        pruned.add(key);
        prunedHere.push(key);
      }
      outputs.set(nodeId, input);
      await updateNodeResult(runId, nodeId, {
        status: 'skipped',
        skipReason: 'disabled',
        output: input,
        startedAt: new Date(),
        finishedAt: new Date(),
        durationMs: 0,
        logs: ['[disabled] node is switched off - passed its input straight through'],
      }, { output: input, pruned: prunedHere });
      return { status: 'success' };
    }

    const begunAt = Date.now();
    await updateNodeResult(runId, nodeId, { status: 'running', startedAt: new Date() });

    const logs = [];
    const prunedHere = [];
    const pushLog = (line) => {
      logs.push(line);
      emit(runId, 'node:log', { nodeId, line });
    };
    const finish = (patch, state) => updateNodeResult(runId, nodeId, {
      finishedAt: new Date(),
      durationMs: Date.now() - begunAt,
      logs,
      ...patch,
    }, state ? { ...state, pruned: prunedHere } : { pruned: prunedHere });
    const pruneOutgoing = (predicate) => {
      for (const edge of outgoingFor(nodeId)) {
        if (!predicate(edge)) continue;
        const key = edgeKey(edge);
        pruned.add(key);
        prunedHere.push(key);
      }
    };

    const childIds = [];
    const ctx = nodeContext(node, {
      input,
      incoming,
      live,
      liveByArrival: [...live].sort((a, b) => (arrival.get(a.source) ?? 0) - (arrival.get(b.source) ?? 0)),
      pushLog,
      pruneOutgoing,
      startChildRun: (childWorkflow, options) => startChildRun(nodeId, childIds, childWorkflow, options),
    });

    let attempts = 1;
    try {
      if (!executor) throw new PermanentFailure(`Node type ${node.type} has no executable behavior`);

      let result;
      let queuedMs;
      if (kindOf(node) === 'work') {
        // Only leaf work takes a queue slot (spec/31, spec/33 §3).
        ({ result, attempts, queuedMs } = await queue.enqueue(
          {
            payload: null,
            run: () => executor.execute(ctx),
            onRetry: ({ attempt, maxAttempts, error, backoff }) =>
              pushLog(`${error} (attempt ${attempt}/${maxAttempts}), retrying in ${backoff}ms...`),
            // spec/33: say that a node is waiting for a slot, and whether it's the
            // workspace's own cap or the shared pool that's holding it back.
            onWait: ({ reason }) => updateNodeResult(runId, nodeId, { waiting: true, waitReason: reason }),
            onStart: ({ attempt, queuedMs: waited }) => {
              if (attempt === 1) updateNodeResult(runId, nodeId, { waiting: false, waitReason: null, queuedMs: waited });
            },
            // spec/35 §6: the retry/backoff timeline, one entry per attempt.
            onAttemptEnd: (info) => recordAttempt(runId, nodeId, info),
          },
          // Tagged so queue stats and caps are per workspace (spec/24, spec/33).
          { maxAttempts: executor.maxAttempts?.(node), meta: { workspaceId: workflow.workspaceId } },
        ));
      } else {
        result = await executor.execute(ctx);
      }

      for (const line of result.logs || []) pushLog(line);

      // spec/32: the node waits for a person or a long delay. It holds nothing:
      // no slot, no loop. If nothing else is in flight the run parks.
      if (result.wait) {
        const since = new Date();
        const { reason, resumeAt = null, patch = {} } = result.wait;
        waitingNodes.set(nodeId, { nodeId, reason, since, resumeAt });
        await updateNodeResult(runId, nodeId, {
          status: 'waiting',
          waitingSince: since,
          resumeAt,
          logs,
          ...patch,
        }, { pruned: prunedHere });
        if (resumeAt) armWait(runId, nodeId, resumeAt);
        if (result.wait.afterPersist) {
          try {
            await result.wait.afterPersist();
          } catch (err) {
            pushLog(`[${node.type}] could not notify: ${err.message}`);
          }
        }
        return { status: 'waiting' };
      }

      const extra = executor.onSuccess ? executor.onSuccess(ctx, result) : {};
      // Success means the error path isn't taken.
      pruneOutgoing((edge) => edge.sourceHandle === 'error');
      const downstream = 'passThrough' in result ? result.passThrough : result.output;
      outputs.set(nodeId, downstream);

      await finish({
        status: 'success',
        output: result.output,
        attempts,
        ...(queuedMs !== undefined && { queuedMs }),
        ...result.patch,
        ...extra,
      }, { output: downstream });
      return { status: 'success' };
    } catch (err) {
      // Lines a node logged before failing (tools' are already redacted).
      for (const line of err.logs || []) pushLog(line);
      attempts = err.attempts || attempts;

      // Cancellation and timeout are run-level decisions, not node failures:
      // the node never finished, and they never route down an error edge.
      if (err.cancelled) {
        await finish({ status: 'skipped' });
        return { status: 'skipped' };
      }

      const message = String(err.message || err);
      pushLog(message);
      const identity = executor?.failurePatch?.(node, err) || {};
      const errorEdges = outgoingFor(nodeId).filter((e) => e.sourceHandle === 'error');

      // Taken only after the node has definitively failed - retries already
      // exhausted by the queue, or a permanent failure (spec/31 §7).
      if (errorEdges.length && supportsErrorHandle(node.type) && !control.cancelled) {
        pruneOutgoing((edge) => edge.sourceHandle !== 'error');
        const errorOutput = {
          error: { message, attempts, nodeId, nodeLabel: labelOf(nodeId), type: node.type },
          input,
        };
        outputs.set(nodeId, errorOutput);
        pushLog('[error-branch] failure handled - continuing down the error edge');
        await finish({ status: 'failed', handled: true, attempts, ...identity }, { output: errorOutput });
        return { status: 'handled' };
      }

      await finish({ status: 'failed', attempts, ...identity });
      return { status: 'failed' };
    }
  }

  /**
   * Resolves a waiting node with the decision that woke it (spec/32 §4 step 4):
   * the executor turns the decision into an output and prunes the branch not
   * taken, then the readiness loop carries on as if the node had just finished.
   */
  async function applyResolution({ nodeId, resolution }) {
    const node = nodesById.get(nodeId);
    waitingNodes.delete(nodeId);
    clearWait(runId, nodeId);
    const executor = node && executorFor(node.type);
    if (!node || !executor?.resolve) {
      await updateNodeResult(runId, nodeId, { status: 'failed', finishedAt: new Date(), logs: ['waiting node is no longer in the graph'] });
      resolved.set(nodeId, 'failed');
      runFailed = true;
      return;
    }
    const input = buildInput(liveIncoming(nodeId));
    const logs = [];
    const prunedHere = [];
    const ctx = nodeContext(node, {
      input,
      pushLog: (line) => { logs.push(line); emit(runId, 'node:log', { nodeId, line }); },
      pruneOutgoing: (predicate) => {
        for (const edge of outgoingFor(nodeId)) {
          if (!predicate(edge)) continue;
          const key = edgeKey(edge);
          pruned.add(key);
          prunedHere.push(key);
        }
      },
    });
    const result = executor.resolve(ctx, resolution);
    for (const line of result.logs || []) ctx.pushLog(line);
    const downstream = 'passThrough' in result ? result.passThrough : result.output;
    outputs.set(nodeId, downstream);
    resolved.set(nodeId, 'success');
    arrival.set(nodeId, order++);
    const existing = (await Run.findOne({ _id: runId }, { nodeResults: { $elemMatch: { nodeId } } }).lean())?.nodeResults?.[0];
    await updateNodeResult(runId, nodeId, {
      status: 'success',
      output: result.output,
      finishedAt: new Date(),
      resumeAt: null,
      logs: [...(existing?.logs || []), ...logs],
      ...result.patch,
    }, { output: downstream, pruned: prunedHere });
    const payload = { runId, workflowId: String(workflow._id), nodeId, decision: resolution.decision ?? null, decidedBy: resolution.decidedBy ?? null };
    emit(runId, 'run:resumed', payload);
    emitToWorkspaceRoom(workflow.workspaceId, 'run:resumed', payload);
  }

  let parkedHere = false;
  let resolveParked;
  try {
    for (;;) {
      if (control.cancelled) break;

      while (control.resolutions.length && !control.cancelled) {
        await applyResolution(control.resolutions.shift());
      }
      if (control.cancelled) break;

      for (const nodeId of readyNodes()) {
        const promise = runNode(nodesById.get(nodeId))
          .then(({ status }) => {
            if (status === 'waiting') return;
            resolved.set(nodeId, status);
            arrival.set(nodeId, order++);
            // A handled failure doesn't fail the run; only the node that owns
            // the error edge is "handled".
            if (status === 'failed') runFailed = true;
          })
          .finally(() => inFlight.delete(nodeId));
        inFlight.set(nodeId, promise);
      }

      if (!inFlight.size) {
        if (control.resolutions.length) continue;
        // Nothing in flight and something waits → park. Leaving activeRuns in
        // the same synchronous step as this check is what makes it atomic with
        // deliverResolution: a decision either lands in `resolutions` above or
        // finds the run gone and takes the rehydrate path.
        if (waitingNodes.size && !control.cancelled) {
          parkedHere = true;
          activeRuns.delete(runId);
          parkingRuns.set(runId, new Promise((resolve) => { resolveParked = resolve; }));
        }
        break;
      }
      const woke = new Promise((resolve) => { control.wake = resolve; });
      await Promise.race([...inFlight.values(), woke]);
      control.wake = null;
    }

    // Let whatever is mid-flight finish: mock handlers are short, and their real
    // results are more useful than throwing them away.
    if (inFlight.size) await Promise.allSettled([...inFlight.values()]);

    if (parkedHere) {
      const activeMs = activeMsBefore + (Date.now() - activeSince);
      const waiting = [...waitingNodes.values()];
      await Run.updateOne(
        { _id: runId },
        { $set: { status: 'waiting', waiting, 'engineState.activeMs': activeMs } },
      );
      const payload = {
        runId,
        workflowId: String(workflow._id),
        waiting: waiting.map(({ nodeId, reason, resumeAt }) => ({ nodeId, reason, resumeAt })),
      };
      emit(runId, 'run:waiting', payload);
      emitToWorkspaceRoom(workflow.workspaceId, 'run:waiting', payload);
      emitRunStatusChanged({ ...statusBase, status: 'waiting' });
      return Run.findById(runId);
    }

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
    if (!parkedHere) activeRuns.delete(runId);
    if (parkedHere) {
      parkingRuns.delete(runId);
      resolveParked?.();
    }
  }

  clearWaitsForRun(runId);
  const cancelledByUser = control.cancelled && control.reason === 'user';
  const status = cancelledByUser ? 'cancelled' : runFailed || control.cancelled ? 'failed' : 'success';
  const finishedAt = new Date();
  const failReason = status !== 'failed' ? null : control.cancelled && control.reason === 'timeout' ? 'timeout' : 'nodes_failed';

  await Run.updateOne(
    { _id: runId },
    {
      $set: {
        status,
        finishedAt,
        cancelReason: control.cancelled ? control.reason : null,
        failReason,
        waiting: [],
        'engineState.activeMs': activeMsBefore + (Date.now() - activeSince),
      },
    },
  );

  if (control.cancelled) {
    emit(runId, 'run:cancelled', { status, cancelReason: control.reason, finishedAt });
  }
  emit(runId, 'run:completed', { status, finishedAt });
  emitRunStatusChanged({ ...statusBase, status, finishedAt });

  const finished = await Run.findById(runId);
  settleTerminal(runId, finished);
  return finished;
}

/**
 * Cancels a parked run (spec/32 API: cancel now handles `waiting`). The run
 * isn't in memory, so this is a database transition: `cancelled`, its waiting
 * and pending nodes `skipped`, timers cleared, children cascaded (spec/31).
 * Returns false if the run wasn't waiting (e.g. a decision resumed it first -
 * then the in-memory cancel is used instead).
 */
export function cancelWaitingRun(runId) {
  const id = String(runId);
  return withRunLock(id, async () => {
    if (activeRuns.has(id)) return requestCancel(id);
    await parked(id);
    if (activeRuns.has(id)) return requestCancel(id);
    const finishedAt = new Date();
    const run = await Run.findOneAndUpdate(
      { _id: id, status: 'waiting' },
      {
        $set: {
          status: 'cancelled',
          cancelReason: 'user',
          failReason: null,
          finishedAt,
          waiting: [],
          'nodeResults.$[open].status': 'skipped',
          'nodeResults.$[open].resumeAt': null,
        },
      },
      { arrayFilters: [{ 'open.status': { $in: ['waiting', 'pending', 'running'] } }], returnDocument: 'after' },
    );
    if (!run) return false;
    clearWaitsForRun(id);
    emit(id, 'run:cancelled', { status: 'cancelled', cancelReason: 'user', finishedAt });
    emit(id, 'run:completed', { status: 'cancelled', finishedAt });
    emitRunStatusChanged(run);
    settleTerminal(id, run);
    const children = await Run.find({ parentRunId: id, status: { $in: ['pending', 'running', 'waiting'] } }).select('_id').lean();
    for (const child of children) {
      const childId = String(child._id);
      if (!requestCancel(childId)) await cancelWaitingRun(childId);
    }
    return true;
  });
}
