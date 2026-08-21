import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { summary } from '../controllers/analyticsController.js';

const router = Router();

router.get('/summary', requireAuth, summary);

export default router;
