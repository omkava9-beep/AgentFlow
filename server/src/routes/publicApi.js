import { Router } from 'express';
import { requireApiKey } from '../middleware/requireApiKey.js';
import { publishEvent, startApiRun, getApiRun } from '../controllers/publicApiController.js';

// Mounted at /api/w. External callers have no session, so the workspace comes
// from the slug in the path and the credential is a workspace API key (spec/24).
const router = Router();

router.post('/:slug/events/:eventName', requireApiKey('events:publish'), publishEvent);
router.post('/:slug/workflows/:id/runs', requireApiKey('runs:create'), startApiRun);
router.get('/:slug/runs/:id', requireApiKey('runs:read'), getApiRun);

export default router;
