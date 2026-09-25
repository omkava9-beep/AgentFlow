import { Router } from 'express';
import { eventEndpointGone } from '../controllers/triggerController.js';

// Retired by spec/24: events are published per workspace at /api/w/:slug/events/:name
// with an API key. Kept only to answer 410 with a pointer to the new URL.
const router = Router();

router.post('/:eventName', eventEndpointGone);

export default router;
