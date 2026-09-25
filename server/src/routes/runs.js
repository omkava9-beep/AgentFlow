import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspace, requirePermission } from '../middleware/requireWorkspace.js';
import { getRunById, cancelRun, rerunRun, retryRun, retryPlan, listRuns } from '../controllers/runController.js';

const router = Router();

router.use(requireAuth, requireWorkspace);

// spec/35: search first, so '/' never reaches the ':id' route.
router.get('/', requirePermission('workflow:read'), listRuns);
router.get('/:id', requirePermission('workflow:read'), getRunById);
router.get('/:id/retry-plan', requirePermission('workflow:read'), retryPlan);
router.post('/:id/rerun', requirePermission('workflow:run'), rerunRun);
router.post('/:id/retry', requirePermission('workflow:run'), retryRun);
router.post('/:id/cancel', requirePermission('workflow:run'), cancelRun);

export default router;
