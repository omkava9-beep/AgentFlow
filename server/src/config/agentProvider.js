import { env } from './env.js';
import { MockAgentProvider } from '../providers/MockAgentProvider.js';
import { LLMAgentProvider } from '../providers/LLMAgentProvider.js';

let instance = null;

export function getAgentProvider() {
  if (instance) return instance;
  if (env.agentProvider === 'anthropic') {
    instance = new LLMAgentProvider({ apiKey: env.anthropicApiKey });
  } else {
    instance = new MockAgentProvider();
  }
  return instance;
}
