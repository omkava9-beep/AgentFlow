import { PermanentFailure } from '../queue/errors.js';

/**
 * Real-LLM implementation on OpenAI's Chat Completions API, only instantiated
 * when AGENT_PROVIDER=openai. The `openai` SDK is imported lazily so the mock
 * default never loads it.
 *
 * Same two-form contract as LLMAgentProvider (spec/05, revised by spec/37 §5):
 *   run(agentConfig, input)   - one call, no tools
 *   step(agentConfig, state)  - one turn of the engine-driven tool-use loop
 * The engine (engine/agentLoop.js) owns the loop, the queue owns retries, and
 * this class only translates between the loop's state and one request.
 *
 * The endpoint is operator configuration (OPENAI_BASE_URL), never a tenant
 * value, so it doesn't go through safeRequest the way integration calls do.
 */
const PROVIDER_LABELS = { openai: 'OpenAI', openrouter: 'OpenRouter' };

export class OpenAIAgentProvider {
  constructor({ apiKey, baseURL = null, requestOptions = {}, client = null, name = 'openai', defaultHeaders = null }) {
    this.providerName = name;
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    // e.g. OpenRouter's optional HTTP-Referer / X-Title attribution headers.
    this.defaultHeaders = defaultHeaders;
    this.requestOptions = requestOptions;
    // Test seam: check scripts pass a stub with the SDK's chat.completions shape.
    this.client = client;
  }

  async #getClient() {
    if (!this.client) {
      const { default: OpenAI } = await import('openai');
      this.client = new OpenAI({
        apiKey: this.apiKey,
        ...(this.baseURL && { baseURL: this.baseURL }),
        ...(this.defaultHeaders && { defaultHeaders: this.defaultHeaders }),
        // The job queue retries with backoff and shows each attempt in the run
        // monitor (spec/35); SDK-internal retries would hide them.
        maxRetries: 0,
        timeout: 120_000,
      });
    }
    return this.client;
  }

  /** Which kind of reasoning actually ran - recorded on AI preset node results (spec/27). */
  get mode() {
    return 'llm';
  }

  get name() {
    return this.providerName;
  }

  async #create(body) {
    const client = await this.#getClient();
    const { model, maxCompletionTokens, reasoningEffort, tokenParam = 'max_completion_tokens' } = this.requestOptions;
    try {
      return await client.chat.completions.create({
        model,
        // OpenAI wants max_completion_tokens; most compatible gateways still
        // take the older max_tokens.
        ...(maxCompletionTokens && { [tokenParam]: maxCompletionTokens }),
        // Only reasoning models accept this; unset means "don't send it".
        ...(reasoningEffort && { reasoning_effort: reasoningEffort }),
        ...body,
      });
    } catch (err) {
      throw classifyApiError(err);
    }
  }

  /** Checked before reading content: these mean there's no usable answer. */
  #assertUsable(choice) {
    if (!choice) throw new Error('OpenAI returned no choices');
    if (choice.message?.refusal) throw new PermanentFailure(`Model declined the request: ${choice.message.refusal}`);
    if (choice.finish_reason === 'content_filter') throw new PermanentFailure('Model output was blocked by the content filter');
    if (choice.finish_reason === 'length') {
      // A turn failure the queue retries; a persistent one exhausts attempts.
      throw new Error('Model hit its output token limit before finishing its turn');
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
    const text = String(message?.content || '').trim();
    if (agentConfig.isHandoff) {
      const candidates = agentConfig.candidates || [];
      const handoffTarget = candidates.find((c) => text.includes(c)) || null;
      return { output: { handoffTarget, raw: text }, logs, handoffTarget };
    }
    return { output: { reply: text }, logs };
  }

  async run(agentConfig, input) {
    const inputText = typeof input === 'string' ? input : JSON.stringify(input ?? {});
    const res = await this.#create({
      messages: [
        { role: 'system', content: this.#system(agentConfig) },
        { role: 'user', content: inputText },
      ],
    });
    const choice = res.choices?.[0];
    this.#assertUsable(choice);
    return this.#finalFrom(agentConfig, choice.message, [
      `[llm-agent] ${agentConfig.label} called ${PROVIDER_LABELS[this.providerName] || this.providerName} (${res.model || this.requestOptions.model})`,
    ]);
  }

  /**
   * One turn. `state` = { input, tools: [{ name, description, inputSchema }],
   * history: [{ raw, calls, results }], forceFinal }. The conversation is
   * rebuilt from `history` every turn: each assistant turn is echoed back as
   * the model sent it (content + tool_calls), followed by one `tool` message
   * per call - every call must be answered, or the API rejects the request.
   */
  async step(agentConfig, state) {
    const inputText = typeof state.input === 'string' ? state.input : JSON.stringify(state.input ?? {});
    const messages = [
      { role: 'system', content: this.#system(agentConfig) },
      { role: 'user', content: inputText },
    ];
    for (const turn of state.history || []) {
      messages.push(turn.raw);
      for (const r of turn.results) {
        messages.push({
          role: 'tool',
          tool_call_id: r.id,
          // Chat Completions has no is_error flag, so a failure says so in words.
          content: r.isError ? `Error: ${r.content}` : String(r.content ?? ''),
        });
      }
    }
    if (state.forceFinal) {
      messages.push({ role: 'user', content: 'You have reached the tool-use limit. Give your final answer now, without calling any tools.' });
    }

    const tools = (state.tools || []).map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: String(t.description || t.name).slice(0, 1024),
        parameters: objectSchema(t.inputSchema),
      },
    }));
    const res = await this.#create({
      messages,
      ...(tools.length && {
        tools,
        // An OpenAI extension some gateways reject; they return parallel calls
        // (or not) on their own.
        ...(this.requestOptions.parallelToolCalls !== false && { parallel_tool_calls: true }),
        ...(state.forceFinal && { tool_choice: 'none' }),
      }),
    });
    const choice = res.choices?.[0];
    this.#assertUsable(choice);
    const message = choice.message || {};
    const logs = [`[llm-agent] ${agentConfig.label} turn ${(state.history || []).length + 1} (${choice.finish_reason})`];

    const toolCalls = (message.tool_calls || []).filter((tc) => tc.type === 'function' && tc.function);
    if (toolCalls.length && !state.forceFinal) {
      return {
        type: 'tool_calls',
        // Echoed back verbatim next turn; `content` may be null alongside tool calls.
        raw: { role: 'assistant', content: message.content ?? null, tool_calls: toolCalls },
        logs,
        calls: toolCalls.map((tc) => ({ id: tc.id, tool: tc.function.name, args: parseArguments(tc.function.arguments) })),
      };
    }
    return { type: 'final', ...this.#finalFrom(agentConfig, message, logs) };
  }
}

/** Function parameters must be a JSON Schema object; MCP and configSchema ones already are. */
function objectSchema(schema) {
  if (schema && typeof schema === 'object' && schema.type === 'object') return schema;
  const base = schema && typeof schema === 'object' ? schema : {};
  return { ...base, type: 'object', properties: base.properties || {} };
}

/** Arguments arrive as a JSON string - parsed, never pattern-matched. */
function parseArguments(args) {
  if (args && typeof args === 'object') return args;
  if (typeof args === 'string') {
    if (!args.trim()) return {};
    try {
      return JSON.parse(args);
    } catch {
      return { __invalid: args };
    }
  }
  return {};
}

/**
 * Maps SDK errors onto the queue's retry rules (CLAUDE.md): a request that can
 * never succeed (bad key, unknown model, invalid request) fails permanently;
 * rate limits, timeouts and 5xx are retried, honouring Retry-After.
 */
function classifyApiError(err) {
  const status = err?.status;
  if (typeof status === 'number' && status >= 400 && status < 500 && ![408, 409, 429].includes(status)) {
    const detail = err?.error?.message || err?.message || `HTTP ${status}`;
    return new PermanentFailure(`The model API rejected the request (${status}): ${detail}`);
  }
  if (status === 429) {
    const header = typeof err?.headers?.get === 'function' ? err.headers.get('retry-after') : err?.headers?.['retry-after'];
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) err.retryAfterMs = seconds * 1000;
  }
  return err;
}
