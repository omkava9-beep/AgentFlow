import { Router } from 'express';
import { receiveWebhook } from '../controllers/triggerController.js';

// Intentionally outside requireAuth (spec/13): external callers have no JWT, so
// the token in the path is the credential.
const router = Router();

router.post('/:token', receiveWebhook);

export default router;
