import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { getRunById, cancelRun } from '../controllers/runController.js';

const router = Router();

router.get('/:id', requireAuth, getRunById);
router.post('/:id/cancel', requireAuth, cancelRun);

export default router;
