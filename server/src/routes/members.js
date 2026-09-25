import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspace, requirePermission } from '../middleware/requireWorkspace.js';
import { list, update, remove } from '../controllers/memberController.js';
import { getSeats } from '../controllers/onboardingController.js';

// Mounted at /api/workspaces/:workspaceId/members. mergeParams exposes
// `:workspaceId` to requireWorkspace, which then ignores the header.
const router = Router({ mergeParams: true });

router.use(requireAuth, requireWorkspace);

router.get('/', requirePermission('members:read'), list);
// Seats vs the plan's member limit (spec/33 §6) for the invite dialog.
router.get('/seats', requirePermission('members:read'), getSeats);
router.patch('/:userId', requirePermission('members:manage'), update);
// No permission gate here: leaving (your own userId) is open to every member.
// Removing anyone else is checked in the membership service.
router.delete('/:userId', remove);

export default router;
