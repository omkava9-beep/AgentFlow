import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspace, requirePermission } from '../middleware/requireWorkspace.js';
import { sendTestEvent, pollNow } from '../controllers/integrationTriggerController.js';

// Mounted at /api/integrations (X-Workspace-Id) and at
// /api/workspaces/:workspaceId/integrations. Only POST routes, so it sits next
// to the catalogue router's GETs without shadowing them.
const router = Router({ mergeParams: true });

router.post('/:id/triggers/:triggerId/test', requireAuth, requireWorkspace, requirePermission('triggers:manage'), sendTestEvent);
router.post('/:id/poll', requireAuth, requireWorkspace, requirePermission('triggers:manage'), pollNow);

export default router;
