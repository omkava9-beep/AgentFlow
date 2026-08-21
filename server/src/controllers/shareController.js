import Workflow from '../models/Workflow.js';
import Run from '../models/Run.js';
import { HttpError } from '../middleware/errorHandler.js';
import { findOwned } from './workflowController.js';
import { generateToken } from '../utils/token.js';
import { env } from '../config/env.js';

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
 * `ownerId`/`shareToken` because neither is the viewer's business.
 */
function publicWorkflow(workflow) {
  return {
    _id: workflow._id,
    name: workflow.name,
    nodes: workflow.nodes,
    edges: workflow.edges,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    readOnly: true,
  };
}

export async function createShareLink(req, res, next) {
  try {
    const workflow = await findOwned(req.params.id, req.userId);
    // Regenerating replaces the old token, which invalidates any link already out
    // there - that's the revoke mechanism, so it's the same endpoint.
    workflow.shareToken = generateToken();
    await workflow.save();
    res.json({ shareToken: workflow.shareToken, url: shareUrl(workflow.shareToken) });
  } catch (err) {
    next(err);
  }
}

export async function deleteShareLink(req, res, next) {
  try {
    const workflow = await findOwned(req.params.id, req.userId);
    workflow.shareToken = null;
    await workflow.save();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/** Unauthenticated: the token in the path is the whole credential. */
export async function getShared(req, res, next) {
  try {
    const workflow = await Workflow.findOne({ shareToken: req.params.shareToken });
    // Same 404 whether the token never existed or was revoked - don't confirm
    // that a link was ever valid.
    if (!workflow) throw new HttpError(404, 'Not found');

    const runs = await Run.find({ workflowId: workflow._id })
      .select('status trigger startedAt finishedAt createdAt')
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({
      workflow: publicWorkflow(workflow),
      runs: runs.map((r) => ({
        id: r._id.toString(),
        status: r.status,
        trigger: r.trigger,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        durationMs: r.startedAt && r.finishedAt ? r.finishedAt - r.startedAt : null,
      })),
    });
  } catch (err) {
    next(err);
  }
}
