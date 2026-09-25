import { env } from './env.js';
import { MockAgentProvider } from '../providers/MockAgentProvider.js';
import { LLMAgentProvider } from '../providers/LLMAgentProvider.js';
import { OpenAIAgentProvider } from '../providers/OpenAIAgentProvider.js';

/**
 * Everything about HOW the real model is called lives here, never in engine
 * code (spec/37 §5): the model id, output budget, thinking and fallbacks.
 *
 * - Adaptive thinking: the model decides when and how much to think.
 * - Server-side refusal fallbacks (`fallbacks: 'default'`, routed by refusal
 *   category), recommended for this model tier.
 * - 16k output tokens on a non-streaming request keeps it under SDK timeouts.
 */
export const llmRequestOptions = Object.freeze({
  model: env.anthropicModel,
  max_tokens: 16000,
  thinking: { type: 'adaptive' },
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
});

/**
 * The OpenAI equivalent. Chat Completions with function calling; the model and
 * output cap come from env, and reasoning effort is only sent when configured
 * (non-reasoning models reject it).
 */
export const openaiRequestOptions = Object.freeze({
  model: env.openaiModel,
  maxCompletionTokens: env.openaiMaxCompletionTokens,
  reasoningEffort: env.openaiReasoningEffort || null,
});

/**
 * OpenRouter reuses the Chat Completions client against its gateway, with the
 * conservative parameter set its upstream providers all accept: `max_tokens`,
 * and no `parallel_tool_calls` (models return parallel calls or not on their
 * own). Free-tier models are rate-limited; a 429 is retried by the job queue,
 * honouring Retry-After (spec/26), so it shows up as attempts in the monitor.
 */
export const openrouterRequestOptions = Object.freeze({
  model: env.openrouterModel,
  maxCompletionTokens: env.openrouterMaxTokens,
  tokenParam: 'max_tokens',
  parallelToolCalls: false,
  reasoningEffort: null,
});

let instance = null;

export function getAgentProvider() {
  if (instance) return instance;
  if (env.agentProvider === 'openai') {
    instance = new OpenAIAgentProvider({
      apiKey: env.openaiApiKey,
      baseURL: env.openaiBaseUrl || null,
      requestOptions: openaiRequestOptions,
    });
  } else if (env.agentProvider === 'openrouter') {
    instance = new OpenAIAgentProvider({
      name: 'openrouter',
      apiKey: env.openrouterApiKey,
      baseURL: env.openrouterBaseUrl,
      requestOptions: openrouterRequestOptions,
      defaultHeaders: {
        ...(env.openrouterAppUrl && { 'HTTP-Referer': env.openrouterAppUrl }),
        'X-Title': env.openrouterAppName,
      },
    });
  } else if (env.agentProvider === 'anthropic') {
    instance = new LLMAgentProvider({ apiKey: env.anthropicApiKey, requestOptions: llmRequestOptions });
  } else {
    instance = new MockAgentProvider();
  }
  return instance;
}

/** Test seam: check scripts drive the tool-use loop with a stubbed provider. */
export function __setAgentProviderForTests(provider) {
  instance = provider;
}
