import { InProcessQueue } from './InProcessQueue.js';
import { env } from '../config/env.js';
import { capFor, onPlanChange } from '../services/planCache.js';
import { recordUsage } from '../services/usage.js';

export const queue = new InProcessQueue({
  concurrency: env.queueConcurrency,
  maxAttempts: env.queueMaxAttempts,
  baseBackoffMs: env.queueBaseBackoffMs,
  // Per-workspace cap from the workspace's plan (spec/33), read from memory.
  capFor,
  // Metering stays out of the queue itself: it just reports what happened.
  onDispatch: ({ workspaceId, waitedMs }) => {
    if (waitedMs > 0) recordUsage(workspaceId, { queueWaitMsTotal: waitedMs });
  },
  onSettled: ({ workspaceId }) => recordUsage(workspaceId, { nodeExecutions: 1 }),
});

// A raised cap should start queued jobs straight away, not on the next enqueue.
onPlanChange((workspaceId) => queue.capsChanged(workspaceId));
