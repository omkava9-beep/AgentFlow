import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspace, requirePermission } from '../middleware/requireWorkspace.js';
import { workspaceStatus, globalStatus } from '../controllers/statusController.js';

// spec/36 §7: every member sees this workspace's slice; the global view is for
// OPERATOR_EMAILS only and 404s for everyone else.
export const workspaceStatusRoutes = Router({ mergeParams: true });
workspaceStatusRoutes.get('/', requireAuth, requireWorkspace, requirePermission('workflow:read'), workspaceStatus);

export const globalStatusRoutes = Router();
globalStatusRoutes.get('/global', requireAuth, globalStatus);
