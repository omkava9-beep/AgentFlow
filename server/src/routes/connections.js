import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspace, requirePermission } from '../middleware/requireWorkspace.js';
import {
  listConnections, createConnectionHandler, getConnection, updateConnectionHandler,
  testConnectionHandler, connectionUsage, deleteConnection, regenerateInboundTokenHandler,
} from '../controllers/connectionController.js';

// Mounted twice: /api/connections (workspace from X-Workspace-Id, spec/25's
// table) and /api/workspaces/:workspaceId/connections (workspace in the path,
// like members and API keys). mergeParams exposes :workspaceId either way.
const router = Router({ mergeParams: true });

router.use(requireAuth, requireWorkspace);

router.get('/', requirePermission('workflow:read'), listConnections);
router.post('/', requirePermission('connections:manage'), createConnectionHandler);
router.get('/:id', requirePermission('connections:use'), getConnection);
router.patch('/:id', requirePermission('connections:manage'), updateConnectionHandler);
router.post('/:id/test', requirePermission('connections:use'), testConnectionHandler);
router.get('/:id/usage', requirePermission('connections:use'), connectionUsage);
router.post('/:id/inbound-token', requirePermission('connections:manage'), regenerateInboundTokenHandler);
router.delete('/:id', requirePermission('connections:manage'), deleteConnection);

export default router;
