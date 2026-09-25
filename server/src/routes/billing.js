import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspace, requirePermission } from '../middleware/requireWorkspace.js';
import { listPlans, getWorkspaceUsage, changePlan } from '../controllers/billingController.js';

// Mounted at /api/workspaces/:workspaceId (spec/33). Per-route middleware rather
// than router.use, so requests for other /api/workspaces/:id/* paths fall
// straight through to their own routers untouched.
const router = Router({ mergeParams: true });

router.get('/usage', requireAuth, requireWorkspace, requirePermission('workflow:read'), getWorkspaceUsage);
router.patch('/plan', requireAuth, requireWorkspace, requirePermission('workspace:billing'), changePlan);

export default router;

/** `GET /api/plans`: the plans table, limits only. */
export const plansRouter = Router();
plansRouter.get('/', requireAuth, listPlans);
