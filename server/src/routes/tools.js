import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { env } from '../config/env.js';

const router = Router();

router.get('/', requireAuth, (req, res) => {
  res.json({
    tools: ToolRegistry.list(),
    // The Node Config Panel shows these as the effective values behind an unset
    // override, so it can say "server default (10%)" instead of just "unset".
    defaults: {
      failureRate: env.defaultToolFailureRate,
      maxAttempts: env.queueMaxAttempts,
    },
  });
});

export default router;
