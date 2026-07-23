import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';

const router = Router();

router.get('/', requireAuth, (req, res) => {
  res.json(ToolRegistry.list());
});

export default router;
