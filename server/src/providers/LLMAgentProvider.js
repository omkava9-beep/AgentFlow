import { PermanentFailure } from '../queue/errors.js';

/**
 * Real-LLM implementation, only instantiated when AGENT_PROVIDER=anthropic.
 * The @anthropic-ai/sdk dependency is required lazily so it's never a hard
 * dependency of the mock-only default path.
 *
 * Two forms (spec/05, revised by spec/37 §5):
 *   run(agentConfig, input)   - one call, no tools (unchanged contract)
 *   step(agentConfig, state)  - one turn of the engine-driven tool-use loop
 * The engine (engine/agentLoop.js) owns the loop; this class only turns the
 * loop's state into one Messages API request and the response into either a
 * final answer or a list of tool calls.
 */
export class LLMAgentProvider {
  constructor({ apiKey, requestOptions = {}, client = null }) {
    this.apiKey = apiKey;
    this.requestOptions = requestOptions;
    // Test seam: check scripts pass a stub with the SDK's messages API shape.
    this.client = client;
  }

  async #getClient() {
    if (!this.client) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      this.client = new Anthropic({ apiKey: this.apiKey });
    }
    return this.client;
  }

  /** Which kind of reasoning actually ran - recorded on AI preset node results (spec/27). */
  get mode() {
    return 'llm';
  }

  /** The request options from config/agentProvider.js; fallbacks go through the beta endpoint. */
  async #create(body) {
    const client = await this.#getClient();
    const { betas, fallbacks, ...options } = this.requestOptions;
    const request = { ...options, ...body };
    if (betas?.length && client.beta?.messages?.create) {
      return client.beta.messages.create({ ...request, betas, ...(fallbacks && { fallbacks }) });
    }
    return client.messages.create(request);
  }

  /** Stop reasons that mean "no usable answer" - checked before reading content. */
  #assertUsable(message) {
    if (message.stop_reason === 'refusal') throw new PermanentFailure('Model declined the request');
    if (message.stop_reason === 'max_tokens') {
      const err = new Error('Model hit max_tokens before finishing its turn');
      err.retryable = true; // a turn failure the queue retries
      throw err;
    }
  }

  #system(agentConfig) {
    let system = agentConfig.systemPrompt || 'You are a helpful workflow agent.';
    if (agentConfig.isHandoff) {
      system += `\n\nWhen you give your final answer, respond with ONLY the exact name of the best candidate to handle this next, from this list: ${(agentConfig.candidates || []).join(', ')}.`;
    }
    return system;
  }

  #finalFrom(agentConfig, message, logs) {
    const text = (message.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (agentConfig.isHandoff) {
      const candidates = agentConfig.candidates || [];
      const handoffTarget = candidates.find((c) => text.includes(c)) || null;
      return { output: { handoffTarget, raw: text }, logs, handoffTarget };
    }
    return { output: { reply: text }, logs };
  }

  async run(agentConfig, input) {
    const inputText = typeof input === 'string' ? input : JSON.stringify(input ?? {});
    const message = await this.#create({
      system: this.#system(agentConfig),
      messages: [{ role: 'user', content: inputText }],
    });
    this.#assertUsable(message);
    return this.#finalFrom(agentConfig, message, [`[llm-agent] ${agentConfig.label} called Anthropic API`]);
  }

  /**
   * One turn. `state` = { input, tools: [{ name, description, inputSchema }],
   * history: [{ raw, calls, results }], forceFinal }. The conversation is
   * rebuilt from `history` every turn, echoing each assistant turn's content
   * back unchanged (including any thinking blocks) and returning ALL of a
   * turn's tool results in one user message - splitting them would teach the
   * model to stop calling tools in parallel.
   */
  async step(agentConfig, state) {
    const inputText = typeof state.input === 'string' ? state.input : JSON.stringify(state.input ?? {});
    const messages = [{ role: 'user', content: inputText }];
    for (const turn of state.history || []) {
      messages.push({ role: 'assistant', content: turn.raw });
      messages.push({
        role: 'user',
        content: turn.results.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.id,
          content: r.content,
          ...(r.isError && { is_error: true }),
        })),
      });
    }
    if (state.forceFinal) {
      const last = messages[messages.length - 1];
      const note = { type: 'text', text: 'You have reached the tool-use limit. Give your final answer now, without calling any tools.' };
      last.content = Array.isArray(last.content) ? [...last.content, note] : [{ type: 'text', text: last.content }, note];
    }

    const message = await this.#create({
      system: this.#system(agentConfig),
      messages,
      tools: (state.tools || []).map((t) => ({
        name: t.name,
        description: String(t.description || t.name).slice(0, 1024),
        input_schema: t.inputSchema,
      })),
      ...(state.forceFinal && { tool_choice: { type: 'none' } }),
    });
    this.#assertUsable(message);
    const logs = [`[llm-agent] ${agentConfig.label} turn ${(state.history || []).length + 1} (${message.stop_reason})`];

    const toolUses = (message.content || []).filter((b) => b.type === 'tool_use');
    if (message.stop_reason === 'tool_use' && toolUses.length) {
      return {
        type: 'tool_calls',
        raw: message.content,
        logs,
        calls: toolUses.map((b) => ({ id: b.id, tool: b.name, args: parseInput(b.input) })),
      };
    }
    return { type: 'final', ...this.#finalFrom(agentConfig, message, logs) };
  }
}

/** Tool input arrives parsed; a string is JSON-parsed, never pattern-matched. */
function parseInput(input) {
  if (input && typeof input === 'object') return input;
  if (typeof input === 'string') {
    try {
      return JSON.parse(input);
    } catch {
      return { __invalid: input };
    }
  }
  return {};
}
