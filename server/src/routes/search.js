import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspace, requirePermission } from '../middleware/requireWorkspace.js';
import { search } from '../controllers/searchController.js';

const router = Router();

router.get('/', requireAuth, requireWorkspace, requirePermission('workflow:read'), search);

export default router;
