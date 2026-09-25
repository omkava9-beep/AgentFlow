import ApiKey from '../models/ApiKey.js';
import Run from '../models/Run.js';
import Workflow from '../models/Workflow.js';
import { findInWorkspace, scopedFilter } from '../tenancy/scoped.js';
import { HttpError } from '../middleware/errorHandler.js';
import { requestCancel, cancelWaitingRun, emitRunStatusChanged } from '../engine/executeRun.js';
import { createAndStartRun, SKIP_REASONS } from '../services/runService.js';
import { sendQuotaExceeded } from '../services/quota.js';
import { graphForRun, loadRunGraph } from '../services/versionService.js';
import { planRetry, buildRetrySeed, listRuns as queryRuns } from '../services/runOpsService.js';

export async function createRun(req, res, next) {
  try {
    const workflow = await findInWorkspace(Workflow, req.params.id, req);
    // spec/30: the Builder's Run is a test run of the draft; "Run published"
    // sends source 'published'. (`kind` is accepted as an alias.)
    const requested = req.body?.source ?? req.body?.kind ?? 'draft';
    if (!['draft', 'published'].includes(requested)) throw new HttpError(400, "source must be 'draft' or 'published'");
    const result = await createAndStartRun(workflow, { trigger: 'manual', triggeredBy: req.userId, source: requested });

    if (!result.ok && result.reason === SKIP_REASONS.QUOTA_EXCEEDED) return sendQuotaExceeded(res, result);
    if (!result.ok) {
      if (result.reason === SKIP_REASONS.NOT_PUBLISHED) throw new HttpError(409, 'Workflow has no published version');
      throw result.reason === SKIP_REASONS.ALREADY_RUNNING
        ? new HttpError(409, requested === 'draft' ? 'This workflow already has a test run in progress' : 'This workflow already has a run of its published version in progress')
        : new HttpError(400, 'Workflow must have at least a Start node before it can run');
    }

    res.status(202).json({ runId: result.runId, status: 'pending' });
  } catch (err) {
    next(err);
  }
}

export async function listRunsForWorkflow(req, res, next) {
  try {
    const workflow = await findInWorkspace(Workflow, req.params.id, req, { select: '_id' });
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 20;
    const runs = await Run.find(scopedFilter(req, { workflowId: workflow._id }))
      .select('status startedAt finishedAt createdAt trigger input.test isDraft versionNumber')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const withDuration = runs.map((r) => ({
      id: r._id.toString(),
      status: r.status,
      trigger: r.trigger,
      // "Send test event" runs (spec/27 §5) get a TEST badge in history.
      test: r.input?.test === true,
      // spec/30: "v3" or "Draft" beside the trigger badge.
      isDraft: Boolean(r.isDraft),
      versionNumber: r.versionNumber ?? null,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      durationMs: r.startedAt && r.finishedAt ? r.finishedAt - r.startedAt : null,
    }));
    res.json(withDuration);
  } catch (err) {
    next(err);
  }
}

export async function getRunById(req, res, next) {
  try {
    const run = await findInWorkspace(Run, req.params.id, req);
    const doc = run.toObject();
    // Named for the monitor's trigger badge tooltip; the key itself never leaves
    // the API-keys screen.
    if (doc.apiKeyId) {
      const key = await ApiKey.findOne(scopedFilter(req, { _id: doc.apiKeyId })).select('name').lean();
      doc.apiKeyName = key?.name || null;
    }
    // spec/30 §2: the graph this run actually executed, so the monitor never
    // redraws an old run against today's draft. null for pre-versioning runs.
    doc.graph = await graphForRun(run);
    res.json(doc);
  } catch (err) {
    next(err);
  }
}

const TERMINAL_STATUSES = ['success', 'failed', 'cancelled'];

export async function cancelRun(req, res, next) {
  try {
    const run = await findInWorkspace(Run, req.params.id, req);
    if (TERMINAL_STATUSES.includes(run.status)) {
      throw new HttpError(409, `Run has already finished (${run.status})`);
    }

    // If the run is executing here, the engine finalizes it cooperatively. If it
    // isn't (the process restarted mid-run, leaving it stuck at 'running'), close
    // it out directly so it can't block the workflow's next run forever.
    // A parked run (spec/32) isn't in memory: cancel it in the database, clear
    // its timers and cascade to its children.
    if (run.status === 'waiting' && await cancelWaitingRun(req.params.id)) {
      return res.status(202).json({ status: 'cancelled' });
    }
    if (!requestCancel(req.params.id)) {
      run.status = 'cancelled';
      run.cancelReason = 'user';
      run.finishedAt = new Date();
      await run.save();
      emitRunStatusChanged(run);
    }

    res.status(202).json({ status: 'cancelled' });
  } catch (err) {
    next(err);
  }
}

// ------------------------------------------------------------------ spec/35

/** Maps createAndStartRun's refusals onto HTTP, the same way createRun does. */
function startFailure(res, result, isDraft) {
  if (result.reason === SKIP_REASONS.QUOTA_EXCEEDED) return sendQuotaExceeded(res, result);
  if (result.reason === SKIP_REASONS.ALREADY_RUNNING) {
    throw new HttpError(409, isDraft ? 'This workflow already has a test run in progress' : 'This workflow already has a run of its published version in progress');
  }
  if (result.reason === SKIP_REASONS.NOT_PUBLISHED) throw new HttpError(409, 'Workflow has no published version');
  throw new HttpError(400, 'Workflow must have at least a Start node before it can run');
}

/** The original run, its workflow and the graph it executed - or a 400 explaining why not. */
async function loadForReplay(req) {
  const run = await findInWorkspace(Run, req.params.id, req);
  const workflow = await findInWorkspace(Workflow, run.workflowId, req);
  let graph;
  try {
    graph = await loadRunGraph(run);
  } catch {
    throw new HttpError(400, 'This run predates versioning, so the graph it executed is unknown');
  }
  const replay = { versionId: run.versionId, graph: run.graph, workspaceId: run.workspaceId };
  return { run, workflow, graph, replay };
}

/** POST /api/runs/:id/rerun - same input, same executed graph, never the current draft. */
export async function rerunRun(req, res, next) {
  try {
    const { run, workflow, replay } = await loadForReplay(req);
    if (run.parentRunId) throw new HttpError(400, "Child runs can't be re-run on their own - re-run the root run");
    const result = await createAndStartRun(workflow, {
      trigger: 'manual',
      triggeredBy: req.userId,
      input: run.input,
      replay,
      lineage: { rerunOf: run._id },
    });
    if (!result.ok) return startFailure(res, result, run.isDraft);
    res.status(202).json({ runId: result.runId });
  } catch (err) {
    next(err);
  }
}

function fromNodeIdsOf(req) {
  const raw = req.body?.fromNodeIds ?? req.query?.fromNodeIds;
  if (raw === undefined || raw === null || raw === '') return null;
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  return list.map((id) => String(id).trim()).filter(Boolean);
}

/** GET /api/runs/:id/retry-plan - what a retry would re-execute and reuse (the UI's preview). */
export async function retryPlan(req, res, next) {
  try {
    const { run, graph } = await loadForReplay(req);
    res.json(planRetry(run, graph, fromNodeIdsOf(req)));
  } catch (err) {
    next(err);
  }
}

/** POST /api/runs/:id/retry { fromNodeIds? } - re-executes the retry set and what depends on it. */
export async function retryRun(req, res, next) {
  try {
    const { run, workflow, graph, replay } = await loadForReplay(req);
    const plan = planRetry(run, graph, fromNodeIdsOf(req));
    if (!plan.retryable) throw new HttpError(400, plan.reason);
    const result = await createAndStartRun(workflow, {
      trigger: 'manual',
      triggeredBy: req.userId,
      input: run.input,
      replay,
      lineage: { retryOf: run._id, retriedFromNodeIds: plan.retrySet },
      seed: buildRetrySeed(run, graph, plan.reused),
    });
    if (!result.ok) return startFailure(res, result, run.isDraft);
    res.status(202).json({ runId: result.runId, reexecuted: plan.reexecuted, reused: plan.reused });
  } catch (err) {
    next(err);
  }
}

/** GET /api/runs - workspace-wide search with cursor pagination (spec/35 §3). */
export async function listRuns(req, res, next) {
  try {
    res.json(await queryRuns(req));
  } catch (err) {
    next(err);
  }
}
