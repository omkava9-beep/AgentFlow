import { Router } from 'express';
import { getShared, getSharedRun } from '../controllers/shareController.js';

// Intentionally outside requireAuth (spec/18): the point of a share link is that
// the recipient isn't logged in.
const router = Router();

router.get('/:shareToken', getShared);
router.get('/:shareToken/runs/:runId', getSharedRun);

export default router;
