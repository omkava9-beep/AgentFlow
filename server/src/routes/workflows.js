import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspace, requirePermission } from '../middleware/requireWorkspace.js';
import { list, create, getById, update, remove } from '../controllers/workflowController.js';
import { createRun, listRunsForWorkflow } from '../controllers/runController.js';
import {
  putSchedule, deleteSchedule,
  regenerateWebhook, putWebhook,
  putEventTrigger, deleteEventTrigger,
} from '../controllers/triggerController.js';
import { createShareLink, deleteShareLink } from '../controllers/shareController.js';
import {
  publishWorkflow, listWorkflowVersions, getWorkflowVersion,
  diffWorkflow, restoreVersion, rollbackVersion,
} from '../controllers/versionController.js';

const router = Router();

// Tenant-scoped (spec/22): the caller must be a member of the X-Workspace-Id
// workspace, and each route then checks the role's permission (spec/23).
router.use(requireAuth, requireWorkspace);

const read = requirePermission('workflow:read');
const edit = requirePermission('workflow:edit');
const run = requirePermission('workflow:run');
const triggers = requirePermission('triggers:manage');
const share = requirePermission('share:manage');
const publish = requirePermission('workflow:publish');

router.get('/', read, list);
router.post('/', edit, create);
router.get('/:id', read, getById);
router.put('/:id', edit, update);
router.delete('/:id', edit, remove);
router.post('/:id/runs', run, createRun);
router.get('/:id/runs', read, listRunsForWorkflow);

router.put('/:id/schedule', triggers, putSchedule);
router.delete('/:id/schedule', triggers, deleteSchedule);
router.post('/:id/webhook/regenerate', triggers, regenerateWebhook);
router.put('/:id/webhook', triggers, putWebhook);
router.put('/:id/event-trigger', triggers, putEventTrigger);
router.delete('/:id/event-trigger', triggers, deleteEventTrigger);
router.post('/:id/share', share, createShareLink);
router.delete('/:id/share', share, deleteShareLink);

// spec/30: versions. Restore changes only the draft, so it needs workflow:edit;
// publishing and rolling back change what triggers run.
router.post('/:id/publish', publish, publishWorkflow);
router.get('/:id/versions', read, listWorkflowVersions);
router.get('/:id/versions/:version', read, getWorkflowVersion);
router.get('/:id/diff', read, diffWorkflow);
router.post('/:id/versions/:version/restore', edit, restoreVersion);
router.post('/:id/versions/:version/rollback', publish, rollbackVersion);

export default router;
