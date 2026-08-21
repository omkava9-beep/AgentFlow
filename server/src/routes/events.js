import { Router } from 'express';
import { dispatchEvent } from '../controllers/triggerController.js';

// Unauthenticated, like the webhook endpoint (spec/21). One event name fans out
// to every workflow subscribed to it.
const router = Router();

router.post('/:eventName', dispatchEvent);

export default router;
