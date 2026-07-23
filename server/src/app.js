import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.js';
import workflowRoutes from './routes/workflows.js';
import runRoutes from './routes/runs.js';
import toolRoutes from './routes/tools.js';
import hookRoutes from './routes/hooks.js';
import sharedRoutes from './routes/shared.js';

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.clientOrigin }));
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRoutes);
  app.use('/api/workflows', workflowRoutes);
  app.use('/api/runs', runRoutes);
  app.use('/api/tools', toolRoutes);
  app.use('/api/hooks', hookRoutes);
  app.use('/api/shared', sharedRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
