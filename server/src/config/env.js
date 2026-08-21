import 'dotenv/config';

const required = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
};

export const env = {
  port: Number(process.env.PORT) || 4000,
  mongodbUri: required('MONGODB_URI'),
  jwtSecret: required('JWT_SECRET'),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  agentProvider: process.env.AGENT_PROVIDER || 'mock',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  defaultToolFailureRate: Number(process.env.DEFAULT_TOOL_FAILURE_RATE ?? 0.1),
  queueConcurrency: Number(process.env.QUEUE_CONCURRENCY) || 4,
  queueMaxAttempts: Number(process.env.QUEUE_MAX_ATTEMPTS) || 3,
  queueBaseBackoffMs: Number(process.env.QUEUE_BASE_BACKOFF_MS) || 500,
  runTimeoutMs: Number(process.env.RUN_TIMEOUT_MS) || 2 * 60 * 1000,
};

if (env.agentProvider === 'anthropic' && !env.anthropicApiKey) {
  throw new Error('AGENT_PROVIDER=anthropic requires ANTHROPIC_API_KEY to be set');
}
