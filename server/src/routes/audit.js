import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspace, requirePermission } from '../middleware/requireWorkspace.js';
import { listAudit, exportAudit } from '../controllers/auditController.js';

// Mounted at /api/workspaces/:workspaceId/audit. List-only on purpose: the log
// is append-only (spec/34 §4), so there is no route that updates or deletes it.
const router = Router({ mergeParams: true });

router.use(requireAuth, requireWorkspace, requirePermission('audit:read'));

router.get('/', listAudit);
router.get('/export', exportAudit);

export default router;
