import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { getRunById } from '../controllers/runController.js';

const router = Router();

router.get('/:id', requireAuth, getRunById);

export default router;
