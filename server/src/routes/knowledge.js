import express, { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspace, requirePermission } from '../middleware/requireWorkspace.js';
import { listDocs, getDoc, createDoc, deleteDoc, search } from '../controllers/knowledgeController.js';

// Mounted at /api/knowledge (X-Workspace-Id) and /api/workspaces/:workspaceId/knowledge.
const router = Router({ mergeParams: true });

router.use(requireAuth, requireWorkspace);

router.get('/', requirePermission('workflow:read'), listDocs);
router.get('/search', requirePermission('workflow:read'), search);
router.get('/:id', requirePermission('workflow:read'), getDoc);
// 200 KB documents, so a larger body limit than the app-wide JSON parser's default.
router.post('/', requirePermission('workflow:edit'), express.json({ limit: '300kb' }), createDoc);
router.delete('/:id', requirePermission('workflow:edit'), deleteDoc);

export default router;
