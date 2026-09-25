import { Router } from 'express';
import { register, login, me, updateMe, changePassword, revokeSessions } from '../controllers/authController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', requireAuth, me);
router.patch('/me', requireAuth, updateMe);
router.post('/password', requireAuth, changePassword);
router.post('/sessions/revoke', requireAuth, revokeSessions);
// Alias with a plainer name for scripts and the UI.
router.post('/logout-all', requireAuth, revokeSessions);

export default router;
