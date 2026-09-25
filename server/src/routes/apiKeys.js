import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspace, requirePermission } from '../middleware/requireWorkspace.js';
import { listApiKeys, createApiKey, revokeApiKey } from '../controllers/apiKeyController.js';

// Mounted at /api/workspaces/:workspaceId/api-keys; mergeParams exposes
// :workspaceId to requireWorkspace.
const router = Router({ mergeParams: true });

router.use(requireAuth, requireWorkspace, requirePermission('apiKeys:manage'));

router.get('/', listApiKeys);
router.post('/', createApiKey);
router.delete('/:keyId', revokeApiKey);

export default router;
