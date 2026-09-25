import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireWorkspace, requirePermission } from '../middleware/requireWorkspace.js';
import {
  listThreads, createThread, reply, editComment, deleteComment, resolveThread, reopenThread, updateThread,
  getWatch, watch, unwatch,
} from '../controllers/commentController.js';

// Mounted at /api, so middleware is attached per route - a router-level
// requireWorkspace here would run for every /api request that passes through.
const router = Router();
const scoped = (permission) => [requireAuth, requireWorkspace, requirePermission(permission)];

router.get('/workflows/:id/threads', ...scoped('workflow:read'), listThreads);
router.post('/workflows/:id/threads', ...scoped('comments:write'), createThread);
router.post('/threads/:threadId/comments', ...scoped('comments:write'), reply);
router.post('/threads/:threadId/resolve', ...scoped('comments:write'), resolveThread);
router.post('/threads/:threadId/reopen', ...scoped('comments:write'), reopenThread);
router.patch('/threads/:threadId', ...scoped('comments:write'), updateThread);
// Author-or-moderator is checked in the controller; comments:write is the floor.
router.patch('/comments/:commentId', ...scoped('comments:write'), editComment);
router.delete('/comments/:commentId', ...scoped('comments:write'), deleteComment);

router.get('/workflows/:id/watch', ...scoped('workflow:read'), getWatch);
router.put('/workflows/:id/watch', ...scoped('workflow:read'), watch);
router.delete('/workflows/:id/watch', ...scoped('workflow:read'), unwatch);

export default router;
