import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspace, requirePermission } from '../middleware/requireWorkspace.js';
import { getOnboarding, setOnboardingDismissed } from '../controllers/onboardingController.js';

// Mounted at /api/workspaces/:workspaceId/onboarding (spec/36 §2).
const router = Router({ mergeParams: true });

router.use(requireAuth, requireWorkspace);

router.get('/', requirePermission('workflow:read'), getOnboarding);
// Dismissal is the member's own preference, so any member may set it.
router.post('/dismiss', setOnboardingDismissed);
router.patch('/', setOnboardingDismissed);

export default router;
