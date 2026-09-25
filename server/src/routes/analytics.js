import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspace, requirePermission } from '../middleware/requireWorkspace.js';
import { summary } from '../controllers/analyticsController.js';

const router = Router();

router.get('/summary', requireAuth, requireWorkspace, requirePermission('workflow:read'), summary);
// spec/35 §5: the per-workflow view (same as /summary?workflowId=).
router.get('/workflows/:workflowId', requireAuth, requireWorkspace, requirePermission('workflow:read'), summary);

export default router;
