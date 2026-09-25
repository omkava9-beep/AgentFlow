import Run from '../models/Run.js';
import Workflow from '../models/Workflow.js';
import { executeRun, emitRunStatusChanged } from '../engine/executeRun.js';
import { ensurePlanLoaded } from './planCache.js';
import { reserveRun } from './quota.js';
import { hub } from '../collab/hub.js';
import { notifyRunFinished } from './watchService.js';
import { resolveRunGraph } from './versionService.js';

export const TRIGGERS = ['manual', 'schedule', 'webhook', 'event', 'api', 'subworkflow'];

/** Reasons a run couldn't be started, for callers that can't just throw an HTTP error. */
export const SKIP_REASONS = {
  NOT_RUNNABLE: 'not-runnable',
  ALREADY_RUNNING: 'already-running',
  // Daily run quota for the workspace's plan (spec/33). Carries limit + resetAt.
  QUOTA_EXCEEDED: 'quota-exceeded',
  // Automatic triggers run the published version (spec/30 §2); there is none.
  NOT_PUBLISHED: 'not-published',
};

/** The run kinds of spec/30: the Builder's test run, or the published version. */
export const RUN_SOURCES = ['draft', 'published'];

export function isRunnable(workflow) {
  return Boolean(workflow?.nodes?.length && workflow.nodes.some((n) => n.type === 'start'));
}

/**
 * The single entry point every trigger goes through — the manual Run button,
 * cron ticks, webhook calls and event dispatch. Four ways in, one way to start a
 * run, so the guards and the Run document can't drift between them.
 *
 * Returns `{ ok: true, runId }` or `{ ok: false, reason }` rather than throwing:
 * cron and webhook callers have no HTTP request to fail, and a fan-out over many
 * workflows needs to skip one without aborting the rest.
 */
/**
 * `skipQuota` is for runs that are part of an existing one (spec/33 §5): a
 * sub-workflow's child runs and a run resuming from an approval. Everything
 * else - re-runs and retry-from-failed included - is a new run and counts.
 */
/**
 * `parent` marks a sub-workflow / loop child run (spec/31 §6): it records the
 * lineage and skips the "already running" guard, which exists to stop
 * duplicate top-level triggers - a loop runs many children of one body at once.
 * `timeoutMs` lets a child inherit what's left of its parent's deadline.
 *
 * Also resolves `done`: the finished Run document, for callers (the engine's
 * child runs) that need to wait on the result.
 */
/**
 * `source` (spec/30 §2): 'draft' runs the canvas as it is right now - the
 * Builder's test run - and 'published' runs the published version. It
 * defaults to 'draft' for manual runs and 'published' for every automatic
 * trigger, so a cron tick never executes a half-edited graph. `replay` pins a
 * previous run's graph (spec/35's re-run and retry).
 */
/**
 * `lineage` (spec/35) records a re-run's `rerunOf` or a retry's `retryOf` +
 * `retriedFromNodeIds`; `seed` hands the engine the original's results to reuse.
 */
export async function createAndStartRun(workflow, { trigger = 'manual', input = null, triggeredBy = null, apiKeyId = null, skipQuota = false, parent = null, timeoutMs, source, replay = null, lineage = null, seed = null } = {}) {
  const kind = source ?? (trigger === 'manual' ? 'draft' : 'published');
  // The draft path flushes the collab hub first (spec/28 §1), so a test run
  // includes edits a collaborator made seconds ago.
  const resolved = await resolveRunGraph(workflow, { source: kind, replay });
  if (!resolved.ok) return { ok: false, reason: SKIP_REASONS.NOT_PUBLISHED };
  const base = workflow.toObject ? workflow.toObject() : workflow;
  workflow = { ...base, name: resolved.graph.name ?? base.name, nodes: resolved.graph.nodes, edges: resolved.graph.edges };

  if (!isRunnable(workflow)) {
    return { ok: false, reason: SKIP_REASONS.NOT_RUNNABLE };
  }

  // One active run per workflow PER KIND (spec/30 §2): an editor's test run
  // must not block the 09:00 production run, nor the reverse.
  const active = !parent && await Run.findOne({ workflowId: workflow._id, isDraft: resolved.isDraft, status: { $in: ['pending', 'running'] } });
  if (active) {
    return { ok: false, reason: SKIP_REASONS.ALREADY_RUNNING, runId: active._id.toString() };
  }

  // After the checks above on purpose: a request rejected as not-runnable or
  // already-running must not use up quota. Loading the plan here also primes
  // the queue's cap cache before this run enqueues its first node.
  const planId = await ensurePlanLoaded(workflow.workspaceId);
  if (!skipQuota && planId !== null) {
    const reservation = await reserveRun(workflow.workspaceId, planId);
    if (!reservation.ok) {
      return { ok: false, reason: SKIP_REASONS.QUOTA_EXCEEDED, ...reservation };
    }
  }

  const run = await Run.create({
    workflowId: workflow._id,
    // The run belongs to its workflow's workspace, whichever trigger started it.
    workspaceId: workflow.workspaceId,
    triggeredBy,
    apiKeyId,
    status: 'pending',
    trigger,
    input,
    // spec/30: which graph this run executes, so its monitor, a re-run and a
    // resume all use exactly this graph whatever the draft looks like later.
    isDraft: resolved.isDraft,
    versionId: resolved.versionId,
    versionNumber: resolved.versionNumber,
    graph: resolved.isDraft ? { name: workflow.name, nodes: workflow.nodes, edges: workflow.edges } : null,
    ...(lineage && {
      rerunOf: lineage.rerunOf || null,
      retryOf: lineage.retryOf || null,
      retriedFromNodeIds: lineage.retriedFromNodeIds,
    }),
    ...(parent && {
      parentRunId: parent.runId,
      parentNodeId: parent.nodeId,
      rootRunId: parent.rootRunId,
      depth: parent.depth,
      iteration: parent.iteration ?? null,
    }),
  });

  const runId = run._id.toString();
  // spec/35 §5: the Runs page prepends it the moment it exists.
  emitRunStatusChanged(run);
  // Deliberately not awaited: the caller responds immediately and the run streams
  // its progress over Socket.io.
  const done = executeRun(runId, workflow, { input, seed, ...(timeoutMs && { timeoutMs }) }).catch((err) => {
    console.error(`Run ${runId} crashed:`, err);
    return null;
  });

  // spec/29: watchers hear about a failed run. Off the settled promise, so the
  // engine itself knows nothing about notifications.
  done.then((finished) => notifyRunFinished(finished)).catch(() => {});

  return { ok: true, runId, done };
}

/** Loads a workflow fresh before a triggered run, so cron/webhook use the current graph. */
export async function startRunForWorkflowId(workflowId, options) {
  const workflow = await Workflow.findById(workflowId); // tenancy: capability lookup (system trigger, id from our own registry)
  if (!workflow) return { ok: false, reason: 'not-found' };
  return createAndStartRun(workflow, options);
}
