import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspace, requirePermission } from '../middleware/requireWorkspace.js';
import { list, decideInApp, getLink, postLink } from '../controllers/approvalController.js';

/** GET /api/approvals - the caller's inbox (spec/32). */
export const approvalsRouter = Router();
approvalsRouter.get('/', requireAuth, requireWorkspace, requirePermission('runs:approve'), list);

/**
 * POST /api/runs/:id/approvals/:nodeId. `runs:approve` gets you in; being an
 * assignee (or holding runs:approve_any) is checked against the run itself.
 */
export const runApprovalsRouter = Router();
runApprovalsRouter.post('/:id/approvals/:nodeId', requireAuth, requireWorkspace, requirePermission('runs:approve'), decideInApp);

/**
 * /api/approval-links/:token - outside auth on purpose, like share links (18):
 * the HMAC signature proves who the link was issued to. GET never decides.
 */
export const approvalLinksRouter = Router();
approvalLinksRouter.get('/:token', getLink);
approvalLinksRouter.post('/:token', postLink);
