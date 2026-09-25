import Workflow from '../models/Workflow.js';
import Run from '../models/Run.js';
import Workspace from '../models/Workspace.js';
import { HttpError } from '../middleware/errorHandler.js';
import { findInWorkspace } from '../tenancy/scoped.js';
import { generateToken } from '../utils/token.js';
import { env } from '../config/env.js';
import { audit } from '../services/audit.js';
import { getPublished, loadRunGraph } from '../services/versionService.js';
import { presentSharedRun } from '../services/runOpsService.js';
import { isValidObjectId } from '../tenancy/scoped.js';

/**
 * Built from CLIENT_ORIGIN, not PUBLIC_BASE_URL: `/shared/:token` is a page in the
 * React app, whereas PUBLIC_BASE_URL points at this API. Using the latter would
 * hand out links to the server's own origin, which serves no such page.
 */
const shareUrl = (token) => `${env.clientOrigin.replace(/\/+$/, '')}/shared/${token}`;

/**
 * What a link-holder is allowed to see.
 *
 * Deliberately a whitelist, not `delete`-ing a few fields off the document. A
 * read-only viewer must never receive `webhook.token` — that's a capability to
 * *start runs*, so leaking it would turn a view link into an execute link. The
 * schedule and event subscription are withheld for the same reason, and
 * `workspaceId`/`createdBy`/`shareToken` because none is the viewer's business.
 */
function publicWorkflow(workflow, version) {
  return {
    _id: workflow._id,
    // spec/30: the published version, never the draft - an unfinished edit
    // must not leak through a public link.
    name: version.name,
    nodes: version.nodes,
    edges: version.edges,
    version: version.version,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    readOnly: true,
  };
}

export async function createShareLink(req, res, next) {
  try {
    // spec/23 §5: an admin can switch public sharing off for the whole workspace.
    if (req.workspace?.settings?.publicSharing === false) {
      throw new HttpError(403, 'Public sharing is disabled for this workspace');
    }
    const workflow = await findInWorkspace(Workflow, req.params.id, req);
    // Regenerating replaces the old token, which invalidates any link already out
    // there - that's the revoke mechanism, so it's the same endpoint.
    workflow.shareToken = generateToken();
    await workflow.save();
    await audit(req, 'share.enabled', { type: 'workflow', id: workflow._id, name: workflow.name });
    res.json({ shareToken: workflow.shareToken, url: shareUrl(workflow.shareToken) });
  } catch (err) {
    next(err);
  }
}

export async function deleteShareLink(req, res, next) {
  try {
    const workflow = await findInWorkspace(Workflow, req.params.id, req);
    workflow.shareToken = null;
    await workflow.save();
    await audit(req, 'share.disabled', { type: 'workflow', id: workflow._id, name: workflow.name });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/**
 * The workflow a share token resolves to, or a 404. Same 404 whether the token
 * never existed or was revoked - don't confirm that a link was ever valid.
 */
async function resolveShareToken(token) {
  const workflow = await Workflow.findOne({ shareToken: token }); // tenancy: capability lookup
  if (!workflow) throw new HttpError(404, 'Not found');
  // Turning sharing off clears every token (spec/23 §5), so this is a second
  // line of defence - but a link must never outlive the workspace switch.
  const workspace = await Workspace.findById(workflow.workspaceId).select('settings');
  if (!workspace || workspace.settings?.publicSharing === false) throw new HttpError(404, 'Not found');
  return workflow;
}

/** Unauthenticated: the token in the path is the whole credential. */
export async function getShared(req, res, next) {
  try {
    const workflow = await resolveShareToken(req.params.shareToken);
    const version = await getPublished(workflow);
    if (!version) {
      // 404-style, but distinguishable so the page can say what's going on.
      return res.status(404).json({ error: "This workflow hasn't been published yet", notPublished: true });
    }

    // Scoped by the workflow the token resolved to, not by a caller's workspace.
    const runs = await Run.find({ workflowId: workflow._id, workspaceId: workflow.workspaceId }) // tenancy: capability lookup
      .select('status trigger startedAt finishedAt createdAt isDraft parentRunId')
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({
      workflow: publicWorkflow(workflow, version),
      runs: runs.map((r) => ({
        id: r._id.toString(),
        status: r.status,
        trigger: r.trigger,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        durationMs: r.startedAt && r.finishedAt ? r.finishedAt - r.startedAt : null,
        // spec/35 §4: only root runs of a published version open in the shared
        // view - a draft test run's graph is an unpublished edit.
        openable: !r.isDraft && !r.parentRunId,
      })),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/shared/:shareToken/runs/:runId (spec/35 §4). Root runs of THIS
 * workflow's published versions only; everything else is the same 404.
 */
export async function getSharedRun(req, res, next) {
  try {
    const workflow = await resolveShareToken(req.params.shareToken);
    if (!isValidObjectId(req.params.runId)) throw new HttpError(404, 'Not found');
    const run = await Run.findOne({ // tenancy: capability lookup (scoped to the token's workflow)
      _id: req.params.runId,
      workflowId: workflow._id,
      workspaceId: workflow.workspaceId,
      parentRunId: null,
      isDraft: { $ne: true },
    }).lean();
    if (!run || !run.versionId) throw new HttpError(404, 'Not found');
    let graph;
    try {
      graph = await loadRunGraph(run);
    } catch {
      throw new HttpError(404, 'Not found');
    }
    res.json(presentSharedRun(run, graph));
  } catch (err) {
    next(err);
  }
}
