import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { list, createFromWorkflow, useTemplate } from '../controllers/templateController.js';

const router = Router();

router.use(requireAuth);

router.get('/', list);
router.post('/', createFromWorkflow);
router.post('/:id/use', useTemplate);

export default router;
