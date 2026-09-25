import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspace, requirePermission } from '../middleware/requireWorkspace.js';
import { list, create, resend, revoke } from '../controllers/invitationController.js';

// Mounted at /api/workspaces/:workspaceId/invitations (mergeParams for requireWorkspace).
const router = Router({ mergeParams: true });

router.use(requireAuth, requireWorkspace, requirePermission('members:invite'));

router.get('/', list);
router.post('/', create);
router.post('/:invId/resend', resend);
router.delete('/:invId', revoke);

export default router;
