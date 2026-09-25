import Run from '../models/Run.js';
import Workflow from '../models/Workflow.js';
import { HttpError } from '../middleware/errorHandler.js';
import { findInWorkspace } from '../tenancy/scoped.js';
import { createAndStartRun, SKIP_REASONS } from '../services/runService.js';
import { sendQuotaExceeded } from '../services/quota.js';
import { dispatchWorkspaceEvent, EVENT_NAME_RE } from '../services/eventService.js';

// The public, API-key-authenticated surface (spec/24 §7). requireApiKey has
// already pinned req.workspaceId to the key's workspace, so every lookup below
// is scoped the same way as the signed-in app's.

const bodyOrNull = (req) => (req.body && Object.keys(req.body).length ? req.body : null);

export async function publishEvent(req, res, next) {
  try {
    const { eventName } = req.params;
    if (!EVENT_NAME_RE.test(eventName)) {
      throw new HttpError(400, 'Event names may only contain letters, digits, ".", "_", ":" and "-" (max 100)');
    }
    const { triggered, skipped } = await dispatchWorkspaceEvent(req.workspaceId, eventName, bodyOrNull(req));
    // 202 with an empty list, never 404: the caller is a publisher, and whether
    // anyone subscribed is not its concern.
    res.status(202).json({ event: eventName, triggered, skipped });
  } catch (err) {
    next(err);
  }
}

export async function startApiRun(req, res, next) {
  try {
    const workflow = await findInWorkspace(Workflow, req.params.id, req);
    const result = await createAndStartRun(workflow, {
      trigger: 'api',
      input: bodyOrNull(req),
      apiKeyId: req.apiKey._id,
    });
    if (!result.ok && result.reason === SKIP_REASONS.QUOTA_EXCEEDED) return sendQuotaExceeded(res, result);
    // spec/30 §2: API runs execute the published version.
    if (!result.ok && result.reason === SKIP_REASONS.NOT_PUBLISHED) throw new HttpError(409, 'Workflow has no published version');
    if (!result.ok) {
      throw result.reason === SKIP_REASONS.ALREADY_RUNNING
        ? new HttpError(409, 'This workflow already has a run in progress')
        : new HttpError(400, 'Workflow must have at least a Start node before it can run');
    }
    res.status(202).json({ runId: result.runId, status: 'pending' });
  } catch (err) {
    next(err);
  }
}

export async function getApiRun(req, res, next) {
  try {
    const run = await findInWorkspace(Run, req.params.id, req, { lean: true });
    const duration = (a, b) => (a && b ? new Date(b) - new Date(a) : null);
    res.json({
      id: run._id.toString(),
      workflowId: run.workflowId.toString(),
      status: run.status,
      trigger: run.trigger,
      cancelReason: run.cancelReason,
      input: run.input,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: duration(run.startedAt, run.finishedAt),
      nodeResults: (run.nodeResults || []).map((r) => ({
        nodeId: r.nodeId,
        status: r.status,
        output: r.output,
        attempts: r.attempts,
        cached: r.cached,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        durationMs: r.durationMs ?? duration(r.startedAt, r.finishedAt),
      })),
    });
  } catch (err) {
    next(err);
  }
}
