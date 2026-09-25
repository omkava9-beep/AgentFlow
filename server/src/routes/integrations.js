import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspace, requirePermission } from '../middleware/requireWorkspace.js';
import { list, getOne, actions, getSandbox, resetSandbox } from '../controllers/integrationController.js';

// The catalogue isn't tenant data, so it only needs a login. Listing a
// connection's dynamic actions reads that connection, so it's workspace-scoped.
const router = Router();

router.get('/', requireAuth, list);
router.get('/:id', requireAuth, getOne);
router.get('/:id/actions', requireAuth, requireWorkspace, requirePermission('workflow:read'), actions);
// The workspace's sandbox state for one integration (spec/27 Sandbox data tab).
router.get('/:id/sandbox', requireAuth, requireWorkspace, requirePermission('workflow:read'), getSandbox);
router.post('/:id/sandbox/reset', requireAuth, requireWorkspace, requirePermission('connections:manage'), resetSandbox);

export default router;
