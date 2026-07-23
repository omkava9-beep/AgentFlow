/**
 * Real-LLM implementation, only instantiated when AGENT_PROVIDER=anthropic.
 * The @anthropic-ai/sdk dependency is required lazily so it's never a hard
 * dependency of the mock-only default path.
 */
export class LLMAgentProvider {
  constructor({ apiKey }) {
    this.apiKey = apiKey;
  }

  async #getClient() {
    if (!this.client) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      this.client = new Anthropic({ apiKey: this.apiKey });
    }
    return this.client;
  }

  async run(agentConfig, input) {
    const client = await this.#getClient();
    const inputText = typeof input === 'string' ? input : JSON.stringify(input ?? {});

    let system = agentConfig.systemPrompt || 'You are a helpful workflow agent.';
    if (agentConfig.isHandoff) {
      system += `\n\nRespond with ONLY the exact name of the best candidate to handle this next, from this list: ${(agentConfig.candidates || []).join(', ')}.`;
    }

    const message = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 512,
      system,
      messages: [{ role: 'user', content: inputText }],
    });

    const text = message.content?.[0]?.text ?? '';
    const logs = [`[llm-agent] ${agentConfig.label} called Anthropic API`];

    if (agentConfig.isHandoff) {
      const candidates = agentConfig.candidates || [];
      const handoffTarget = candidates.find((c) => text.includes(c)) || null;
      return { output: { handoffTarget, raw: text }, logs, handoffTarget };
    }

    return { output: { reply: text }, logs };
  }
}
