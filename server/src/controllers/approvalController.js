import Run from '../models/Run.js';
import { findInWorkspace } from '../tenancy/scoped.js';
import { can } from '../tenancy/permissions.js';
import { decide, listApprovals, describeLink, decideViaLink } from '../services/approvalService.js';

/** 409s carry the decision that won, so the loser can show "already approved by Alice". */
function send409(res, err) {
  return res.status(409).json({ error: err.publicMessage || 'Already decided', ...(err.details || {}) });
}

export async function list(req, res, next) {
  try {
    const all = req.query.all === '1' && can(req.role, 'runs:approve_any');
    const status = req.query.status === 'decided' ? 'decided' : 'pending';
    res.json(await listApprovals({ workspaceId: req.workspaceId, userId: req.userId, status, all }));
  } catch (err) {
    next(err);
  }
}

export async function decideInApp(req, res, next) {
  try {
    const run = await findInWorkspace(Run, req.params.id, req, { lean: true });
    const { decision, comment } = req.body || {};
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'approve' or 'reject'" });
    }
    const outcome = await decide({
      runId: run._id,
      nodeId: req.params.nodeId,
      userId: req.userId,
      decision,
      comment,
      via: 'app',
      override: can(req.role, 'runs:approve_any'),
      req,
    });
    res.json(outcome);
  } catch (err) {
    if (err.status === 409) return send409(res, err);
    next(err);
  }
}

export async function getLink(req, res, next) {
  try {
    res.json(await describeLink(req.params.token));
  } catch (err) {
    next(err);
  }
}

export async function postLink(req, res, next) {
  try {
    const { decision, comment } = req.body || {};
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'approve' or 'reject'" });
    }
    res.json(await decideViaLink(req.params.token, { decision, comment }));
  } catch (err) {
    if (err.status === 409) return send409(res, err);
    next(err);
  }
}
