import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { getByToken, accept } from '../controllers/invitationController.js';

const router = Router();

// Public like the share endpoint (spec/18): the invitee may not have an account
// yet. It returns only what the invite page needs to render.
router.get('/:token', getByToken);
router.post('/:token/accept', requireAuth, accept);

export default router;
