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
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  // Unset → api.openai.com. Set for an OpenAI-compatible gateway or proxy.
  openaiBaseUrl: process.env.OPENAI_BASE_URL || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
  // low | medium | high - reasoning models only; unset sends nothing.
  openaiReasoningEffort: process.env.OPENAI_REASONING_EFFORT || '',
  openaiMaxCompletionTokens: Number(process.env.OPENAI_MAX_COMPLETION_TOKENS) || 4096,
  // OpenRouter: an OpenAI-compatible gateway (Chat Completions) in front of
  // many models, including a free tier (ids ending ":free", plus the
  // `openrouter/free` router that picks an available free model). Same client
  // as OpenAI, its own key/model so switching providers is one line.
  openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
  openrouterBaseUrl: (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
  openrouterModel: process.env.OPENROUTER_MODEL || 'openrouter/free',
  openrouterMaxTokens: Number(process.env.OPENROUTER_MAX_TOKENS) || 4096,
  // Optional attribution OpenRouter shows on its dashboard/rankings.
  openrouterAppUrl: process.env.OPENROUTER_APP_URL || '',
  openrouterAppName: process.env.OPENROUTER_APP_NAME || 'AgentFlow',
  defaultToolFailureRate: Number(process.env.DEFAULT_TOOL_FAILURE_RATE ?? 0.1),
  queueConcurrency: Number(process.env.QUEUE_CONCURRENCY) || 8,
  queueMaxAttempts: Number(process.env.QUEUE_MAX_ATTEMPTS) || 3,
  queueBaseBackoffMs: Number(process.env.QUEUE_BASE_BACKOFF_MS) || 500,
  runTimeoutMs: Number(process.env.RUN_TIMEOUT_MS) || 2 * 60 * 1000,
  // Used to build copy-pasteable webhook URLs; the server can't know how it's
  // reached from outside, so it has to be told.
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || `http://localhost:${Number(process.env.PORT) || 4000}`).replace(/\/+$/, ''),
  // Credential vault key (spec/25). Validated below: 32 bytes, base64.
  secretsMasterKey: process.env.SECRETS_MASTER_KEY || '',
  // Live integrations are the default (C2). `false` is the kill switch for
  // offline development and deterministic check runs.
  integrationsLive: process.env.INTEGRATIONS_LIVE !== 'false',
  // spec/27's SSRF guard. The HTTP_TOOL_ prefix is historical; both apply to
  // every safeRequest caller.
  httpAllowPrivateNetworks: process.env.HTTP_TOOL_ALLOW_PRIVATE_NETWORKS === 'true',
  httpAllowedHosts: (process.env.HTTP_TOOL_ALLOWED_HOSTS || '')
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
  // Collaboration hub (spec/28): flush debounce, flush ceiling, soft-lock TTL.
  collabFlushDebounceMs: Number(process.env.COLLAB_FLUSH_DEBOUNCE_MS) || 1000,
  collabFlushMaxMs: Number(process.env.COLLAB_FLUSH_MAX_MS) || 5000,
  collabLockTtlMs: Number(process.env.COLLAB_LOCK_TTL_MS) || 60_000,
  // Advanced nodes (spec/31). The Code node runs with server privileges - see
  // the spec's warning - so it can be switched off per deployment.
  codeNodeEnabled: process.env.CODE_NODE_ENABLED !== 'false',
  codeNodeTimeoutMs: Math.min(Number(process.env.CODE_NODE_TIMEOUT_MS) || 1000, 5000),
  codeNodeMemoryMb: Number(process.env.CODE_NODE_MEMORY_MB) || 64,
  delayMaxMs: Number(process.env.DELAY_MAX_MS) || 24 * 60 * 60 * 1000,
  delayInlineMaxMs: Number(process.env.DELAY_INLINE_MAX_MS) || 60 * 1000,
  loopMaxItems: Number(process.env.LOOP_MAX_ITEMS) || 500,
  subworkflowMaxDepth: Number(process.env.SUBWORKFLOW_MAX_DEPTH) || 5,
  // spec/32 §8: signs approve/reject links. Falls back to a key derived from
  // JWT_SECRET (HKDF) when unset, so approvals work out of the box.
  approvalLinkSecret: process.env.APPROVAL_LINK_SECRET || '',
  // MCP and agent tool use (spec/37).
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
  mcpCallTimeoutMs: Math.min(Number(process.env.MCP_CALL_TIMEOUT_MS) || 30_000, 30_000),
  mcpIdleCloseMs: Number(process.env.MCP_IDLE_CLOSE_MS) || 5 * 60 * 1000,
  // The operator's stdio allowlist. Read once at startup; relative to server/.
  mcpAllowlistPath: process.env.MCP_ALLOWLIST_PATH || 'mcp-servers.json',
  agentToolResultMaxChars: Number(process.env.AGENT_TOOL_RESULT_MAX_CHARS) || 8000,
  // spec/36 §7: who may see the cross-tenant status view. An operator setting,
  // not a workspace role, because it spans every tenant. Empty = nobody.
  operatorEmails: (process.env.OPERATOR_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
};

const GENERATE_KEY = `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`;
if (Buffer.from(env.secretsMasterKey, 'base64').length !== 32) {
  throw new Error(`SECRETS_MASTER_KEY must be 32 bytes of base64 — generate one with: ${GENERATE_KEY}`);
}

if (env.httpAllowPrivateNetworks) {
  console.warn('[env] HTTP_TOOL_ALLOW_PRIVATE_NETWORKS=true — outbound requests may reach private networks. Local development only.');
}

const AGENT_PROVIDERS = ['mock', 'openai', 'openrouter', 'anthropic'];
if (!AGENT_PROVIDERS.includes(env.agentProvider)) {
  throw new Error(`AGENT_PROVIDER must be one of ${AGENT_PROVIDERS.join(', ')} (got "${env.agentProvider}")`);
}
if (env.agentProvider === 'openai' && !env.openaiApiKey) {
  throw new Error('AGENT_PROVIDER=openai requires OPENAI_API_KEY to be set');
}
if (env.agentProvider === 'openrouter' && !env.openrouterApiKey) {
  throw new Error('AGENT_PROVIDER=openrouter requires OPENROUTER_API_KEY to be set (get one at https://openrouter.ai/keys)');
}
if (env.agentProvider === 'anthropic' && !env.anthropicApiKey) {
  throw new Error('AGENT_PROVIDER=anthropic requires ANTHROPIC_API_KEY to be set');
}
