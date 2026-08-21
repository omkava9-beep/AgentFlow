import { InProcessQueue } from './InProcessQueue.js';
import { env } from '../config/env.js';

export const queue = new InProcessQueue({
  concurrency: env.queueConcurrency,
  maxAttempts: env.queueMaxAttempts,
  baseBackoffMs: env.queueBaseBackoffMs,
});
