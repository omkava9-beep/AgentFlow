import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { list, create, getById, update, remove } from '../controllers/workflowController.js';
import { createRun, listRunsForWorkflow } from '../controllers/runController.js';

const router = Router();

router.use(requireAuth);

router.get('/', list);
router.post('/', create);
router.get('/:id', getById);
router.put('/:id', update);
router.delete('/:id', remove);
router.post('/:id/runs', createRun);
router.get('/:id/runs', listRunsForWorkflow);

export default router;
