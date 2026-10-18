import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.js';
import workflowRoutes from './routes/workflows.js';
import runRoutes from './routes/runs.js';
import integrationRoutes from './routes/integrations.js';
import hookRoutes from './routes/hooks.js';
import sharedRoutes from './routes/shared.js';
import eventRoutes from './routes/events.js';
import templateRoutes from './routes/templates.js';
import analyticsRoutes from './routes/analytics.js';
import searchRoutes from './routes/search.js';
import workspaceRoutes from './routes/workspaces.js';
import memberRoutes from './routes/members.js';
import onboardingRoutes from './routes/onboarding.js';
import invitationRoutes from './routes/invitations.js';
import publicInvitationRoutes from './routes/publicInvitations.js';
import outboxRoutes from './routes/outbox.js';
import commentRoutes from './routes/comments.js';
import notificationRoutes from './routes/notifications.js';
import apiKeyRoutes from './routes/apiKeys.js';
import publicApiRoutes from './routes/publicApi.js';
import connectionRoutes from './routes/connections.js';
import auditRoutes from './routes/audit.js';
import billingRoutes, { plansRouter } from './routes/billing.js';
import inboundHookRoutes from './routes/inboundHooks.js';
import integrationTriggerRoutes from './routes/integrationTriggers.js';
import knowledgeRoutes from './routes/knowledge.js';
import { approvalsRouter, runApprovalsRouter, approvalLinksRouter } from './routes/approvals.js';
import { allowlistRouter as mcpAllowlistRoutes, toolsRouter as mcpToolsRoutes } from './routes/mcp.js';
import { workspaceStatusRoutes, globalStatusRoutes } from './routes/status.js';

export function createApp() {

  const app = express();
  
  // CORS configured to dynamically reflect any incoming origin request
  app.use(cors({
    origin: function (origin, callback) {
      // Allows all origins, including extension setups, local testing, and serverless edge requests
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
  }));

  // Vercel never runs src/index.js, so the first request has to open Mongo.
  app.use((req, res, next) => {
    connectDB().then(() => next()).catch(next);
  });
  // Before express.json(): inbound provider webhooks need the raw bytes for
  // their signatures (spec/27 §5), and Knowledge Base uploads need a bigger
  // body limit than the app-wide default (spec/27 §7). Each parses its own body.
  app.use('/api/w/:slug/hooks', inboundHookRoutes);
  app.use('/api/workspaces/:workspaceId/knowledge', knowledgeRoutes);
  app.use('/api/knowledge', knowledgeRoutes);
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRoutes);
  app.use('/api/workspaces/:workspaceId/members', memberRoutes);
  app.use('/api/workspaces/:workspaceId/onboarding', onboardingRoutes);
  app.use('/api/workspaces/:workspaceId/invitations', invitationRoutes);
  app.use('/api/workspaces/:workspaceId/api-keys', apiKeyRoutes);
  app.use('/api/workspaces/:workspaceId', billingRoutes);
  app.use('/api/plans', plansRouter);
  // spec/37: MCP tool discovery, before the generic connection routes.
  app.use('/api/workspaces/:workspaceId/connections/:cid/mcp', mcpToolsRoutes);
  app.use('/api/connections/:cid/mcp', mcpToolsRoutes);
  app.use('/api/mcp', mcpAllowlistRoutes);
  app.use('/api/workspaces/:workspaceId/connections', connectionRoutes);
  app.use('/api/workspaces/:workspaceId/audit', auditRoutes);
  app.use('/api/workspaces/:workspaceId/status', workspaceStatusRoutes);
  app.use('/api/status', globalStatusRoutes);
  app.use('/api/workspaces', workspaceRoutes);
  app.use('/api/invitations', publicInvitationRoutes);
  app.use('/api/outbox', outboxRoutes);
  app.use('/api/connections', connectionRoutes);
  // spec/29: threads, comments and watching. Paths live under /workflows,
  // /threads and /comments; mounted first so /workflows/:id/threads isn't
  // swallowed by the workflows router.
  app.use('/api', commentRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/workflows', workflowRoutes);
  // Before runRoutes, so its router-level auth doesn't run twice (spec/32).
  app.use('/api/runs', runApprovalsRouter);
  app.use('/api/runs', runRoutes);
  app.use('/api/approvals', approvalsRouter);
  app.use('/api/approval-links', approvalLinksRouter);
  app.use('/api/workspaces/:workspaceId/integrations', integrationTriggerRoutes);
  app.use('/api/integrations', integrationTriggerRoutes);
  app.use('/api/integrations', integrationRoutes);
  app.use('/api/hooks', hookRoutes);
  app.use('/api/templates', templateRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api/events', eventRoutes);
  // External callers: workspace by slug, API-key auth (spec/24).
  app.use('/api/w', publicApiRoutes);
  app.use('/api/shared', sharedRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

// Vercel inspects this identifier: `export default createApp()` is not treated
// as a function/server even though it returns one.
const app = createApp();
export default app;
