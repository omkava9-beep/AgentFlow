import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspace, requirePermission } from '../middleware/requireWorkspace.js';
import { list, create, getBySlug, update, remove } from '../controllers/workspaceController.js';

const router = Router();

router.use(requireAuth);

// Not workspace-scoped: these are about *which* workspaces the caller has.
router.get('/', list);
router.post('/', create);
router.get('/by-slug/:slug', getBySlug);

// The path names the workspace, so requireWorkspace reads it from
// `:workspaceId` instead of the X-Workspace-Id header.
router.patch('/:workspaceId', requireWorkspace, requirePermission('workspace:update'), update);
router.delete('/:workspaceId', requireWorkspace, requirePermission('workspace:delete'), remove);

export default router;
