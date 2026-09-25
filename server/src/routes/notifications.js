import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { list, markRead, markAllRead } from '../controllers/notificationController.js';

// JWT only, no workspace (spec/29 API): the bell spans every workspace you're in.
const router = Router();
router.use(requireAuth);

router.get('/', list);
router.post('/read-all', markAllRead);
router.post('/:id/read', markRead);

export default router;
