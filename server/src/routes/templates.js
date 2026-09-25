import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspace, requirePermission } from '../middleware/requireWorkspace.js';
import { list, createFromWorkflow, useTemplate, updateTemplate, deleteTemplate } from '../controllers/templateController.js';

const router = Router();

router.use(requireAuth, requireWorkspace);

router.get('/', requirePermission('workflow:read'), list);
router.post('/', requirePermission('templates:create'), createFromWorkflow);
router.post('/:id/use', requirePermission('templates:use'), useTemplate);
router.patch('/:id', requirePermission('templates:create'), updateTemplate);
router.delete('/:id', requirePermission('templates:create'), deleteTemplate);

export default router;
