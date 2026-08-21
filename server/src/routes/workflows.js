import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { list, create, getById, update, remove } from '../controllers/workflowController.js';
import { createRun, listRunsForWorkflow } from '../controllers/runController.js';
import {
  putSchedule, deleteSchedule,
  regenerateWebhook, putWebhook,
  putEventTrigger, deleteEventTrigger,
} from '../controllers/triggerController.js';
import { createShareLink, deleteShareLink } from '../controllers/shareController.js';

const router = Router();

router.use(requireAuth);

router.get('/', list);
router.post('/', create);
router.get('/:id', getById);
router.put('/:id', update);
router.delete('/:id', remove);
router.post('/:id/runs', createRun);
router.get('/:id/runs', listRunsForWorkflow);

router.put('/:id/schedule', putSchedule);
router.delete('/:id/schedule', deleteSchedule);
router.post('/:id/webhook/regenerate', regenerateWebhook);
router.put('/:id/webhook', putWebhook);
router.put('/:id/event-trigger', putEventTrigger);
router.delete('/:id/event-trigger', deleteEventTrigger);
router.post('/:id/share', createShareLink);
router.delete('/:id/share', deleteShareLink);

export default router;
