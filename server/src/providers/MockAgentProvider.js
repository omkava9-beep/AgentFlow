function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarize(text) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  if (words.length <= 12) return words.join(' ');
  return `${words.slice(0, 12).join(' ')}...`;
}

/**
 * Deterministic-ish templated stand-in for real LLM reasoning: no network calls,
 * just enough structure to exercise the orchestration engine end to end.
 */
/**
 * spec/27's AI presets, templated. Each mirrors the JSON an LLM is asked for,
 * so a workflow built against the mock keeps working when AGENT_PROVIDER flips.
 */
const PRESETS = {
  classify({ labels = [] }, inputText) {
    const lower = inputText.toLowerCase();
    const matched = labels.find((l) => lower.includes(String(l).toLowerCase()));
    const label = matched || labels[Math.floor(Math.random() * labels.length)] || null;
    return {
      label,
      confidence: matched ? 0.9 : 0.4,
      reason: matched ? `input mentions "${matched}"` : 'no label appeared in the input - picked one at random',
    };
  },
  extract({ fields = [] }, _inputText, input) {
    const flat = {};
    const walk = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) walk(v);
        else if (!(k.toLowerCase() in flat)) flat[k.toLowerCase()] = v;
      }
    };
    walk(input);
    return Object.fromEntries(fields.map((f) => [f, flat[String(f).toLowerCase()] ?? null]));
  },
  summarize({ maxWords = 30 }, inputText) {
    const words = inputText.replace(/[{}"[\]]/g, ' ').split(/\s+/).filter(Boolean);
    const n = Math.max(1, Number(maxWords) || 30);
    return { summary: words.slice(0, n).join(' ') + (words.length > n ? '…' : ''), words: Math.min(n, words.length) };
  },
  draft_reply({ tone = 'friendly' }, inputText) {
    const openers = { friendly: 'Hi there, thanks for reaching out!', formal: 'Dear customer, thank you for your message.', apologetic: "We're sorry for the trouble this has caused." };
    return { reply: `${openers[tone] || openers.friendly} We've received your note (\"${summarize(inputText)}\") and will follow up shortly.`, tone };
  },
};

export class MockAgentProvider {
  /** Which kind of reasoning actually ran - recorded on AI preset node results (spec/27). */
  get mode() {
    return 'mock';
  }

  async run(agentConfig, input) {
    const latency = 300 + Math.random() * 700;
    await delay(latency);

    // Tagged like the tool handlers' failures so the UI reads it as intentional
    // rather than as a bug. Agent nodes get no configurable dial (spec/17) - this
    // small fixed chance just keeps agent retries exercised too.
    if (Math.random() < 0.05) {
      throw new Error(`[simulated failure] mock agent "${agentConfig.label}" failed to produce a response`);
    }

    const inputText = typeof input === 'string' ? input : JSON.stringify(input ?? {});
    const logs = [`[mock-agent] ${agentConfig.label} received input`, `[mock-agent] system prompt: "${summarize(agentConfig.systemPrompt)}"`];

    if (agentConfig.preset && PRESETS[agentConfig.preset.kind]) {
      const output = PRESETS[agentConfig.preset.kind](agentConfig.preset, inputText, input);
      logs.push(`[mock-agent] ${agentConfig.preset.kind} preset (templated)`);
      return { output, logs };
    }

    if (agentConfig.isHandoff) {
      const candidates = agentConfig.candidates || [];
      const lower = inputText.toLowerCase();
      const matched = candidates.find((c) => lower.includes(c.toLowerCase()));
      const handoffTarget = matched || candidates[Math.floor(Math.random() * candidates.length)] || null;
      // Say which it was: claiming a keyword match on a random pick makes the
      // run log lie about how the decision was reached.
      const reason = matched ? `input mentioned "${matched}"` : 'no candidate matched the input - picked one at random';
      logs.push(`[mock-agent] handoff decision -> ${handoffTarget} (${reason})`);
      return { output: { handoffTarget, reason }, logs, handoffTarget };
    }

    const output = {
      reply: `${agentConfig.label || 'Agent'} processed: ${summarize(inputText)}`,
      basedOn: agentConfig.systemPrompt ? summarize(agentConfig.systemPrompt) : null,
    };
    return { output, logs };
  }

  /**
   * One turn of the engine-driven tool-use loop (spec/37 §5), keyless and
   * deterministic: the same input and tool list always make the same choices.
   *
   * - Picks the tool whose name/description shares the most words with the
   *   input (the only tool, if there is exactly one and nothing overlaps).
   * - Fills arguments from the input by property name (one level into a
   *   fan-in object), then schema defaults; a required string it can't find
   *   gets a summary of the input. Unfillable → skipped, and the log says why.
   * - At most two tool steps (best match, then second-best if that overlapped
   *   too), then a final answer that templates the tool outputs in.
   * The chosen tools are called for real - by the engine, through the queue.
   */
  async step(agentConfig, state) {
    await delay(80 + Math.random() * 200);
    if (Math.random() < 0.05) {
      throw new Error(`[simulated failure] mock agent "${agentConfig.label}" failed to produce a response`);
    }
    const history = state.history || [];
    const inputText = typeof state.input === 'string' ? state.input : JSON.stringify(state.input ?? {});
    const logs = [];

    if (!state.forceFinal && history.length < 2) {
      const used = new Set(history.flatMap((h) => h.calls.map((c) => c.tool)));
      const ranked = rankTools(state.tools || [], inputText);
      let candidates;
      if (history.length === 0) {
        candidates = ranked.length ? ranked : (state.tools?.length === 1 ? [{ tool: state.tools[0], score: 0 }] : []);
      } else {
        // The second step only ever uses the runner-up, and only if it overlapped.
        candidates = ranked.slice(1).filter((r) => !used.has(r.tool.name));
      }
      for (const { tool, score } of candidates) {
        const filled = fillArgs(tool, state.input, inputText);
        if (filled.skip) {
          logs.push(`[mock-agent] skipped ${tool.name}: ${filled.skip}`);
          continue;
        }
        logs.push(`[mock-agent] step ${history.length + 1}: chose ${tool.name} (${score ? `${score} matching word${score === 1 ? '' : 's'}` : 'only tool available'})`);
        return { type: 'tool_calls', calls: [{ id: `mock-${history.length + 1}-1`, tool: tool.name, args: filled.args }], logs };
      }
      if (history.length === 0) logs.push('[mock-agent] no tool matched the input - answering without tools');
    }

    const results = history.flatMap((h) => h.results);
    const parts = results.map((r) => `${r.tool}(${summarizeArgs(r.args)}) ${r.isError ? `failed: ${summarize(r.content)}` : `→ ${summarizeOutput(r.output)}`}`);
    const reply = parts.length
      ? `${agentConfig.label || 'Agent'} used ${parts.length} tool call${parts.length === 1 ? '' : 's'} — ${parts.join('; ')}`
      : `${agentConfig.label || 'Agent'} processed: ${summarize(inputText)}`;

    if (agentConfig.isHandoff) {
      const candidates = agentConfig.candidates || [];
      // Tool outputs first: "lookup_customer says gold" is what should route.
      const haystack = `${results.map((r) => JSON.stringify(r.output ?? r.content ?? '')).join(' ')} ${inputText}`.toLowerCase();
      const matched = candidates.find((c) => haystack.includes(String(c).toLowerCase()));
      const handoffTarget = matched || candidates[0] || null;
      const reason = matched ? `"${matched}" appeared in the tool results or input` : 'no candidate matched - defaulted to the first';
      logs.push(`[mock-agent] handoff decision -> ${handoffTarget} (${reason})`);
      return { type: 'final', output: { handoffTarget, reason, reply }, logs, handoffTarget };
    }
    return { type: 'final', output: { reply, toolsUsed: results.map((r) => r.tool) }, logs };
  }
}

// ------------------------------------------------------------------ mock tool choice

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'into', 'your', 'you', 'are', 'was', 'has', 'have', 'its', 'can', 'get', 'set', 'use', 'any', 'all', 'one', 'our', 'out', 'not', 'but', 'via', 'per']);

function tokens(text) {
  return String(text ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w));
}

function rankTools(tools, inputText) {
  const input = new Set(tokens(inputText));
  return tools
    .map((tool, index) => {
      const words = new Set(tokens(`${tool.name.replace(/__/g, ' ')} ${tool.description || ''}`));
      let score = 0;
      for (const w of input) if (words.has(w)) score += 1;
      return { tool, score, index };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

const typeOf = (schema) => (Array.isArray(schema?.type) ? schema.type.find((t) => t !== 'null') : schema?.type);

/** input[prop], case-insensitively, then a key ending in it (customerId → id), then one level down. */
function lookup(input, prop) {
  if (!input || typeof input !== 'object') return undefined;
  const direct = (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
    if (obj[prop] !== undefined) return obj[prop];
    const lower = prop.toLowerCase();
    const keys = Object.keys(obj);
    const ci = keys.find((k) => k.toLowerCase() === lower);
    if (ci) return obj[ci];
    const suffix = keys.find((k) => k.toLowerCase().endsWith(lower) && typeof obj[k] !== 'object');
    return suffix ? obj[suffix] : undefined;
  };
  const top = direct(input);
  if (top !== undefined) return top;
  // A fan-in input is keyed by source node id (spec/06).
  for (const value of Object.values(input)) {
    const nested = direct(value);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function coerce(value, schema) {
  const type = typeOf(schema);
  if (type === 'string' && typeof value !== 'string') return typeof value === 'object' ? JSON.stringify(value) : String(value);
  if ((type === 'number' || type === 'integer') && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  if (type === 'boolean' && typeof value === 'string') return value === 'true';
  return value;
}

function fillArgs(tool, input, inputText) {
  const schema = tool.inputSchema || {};
  const props = schema.properties || {};
  const required = new Set(schema.required || []);
  const args = {};
  const missing = [];
  for (const [prop, sub] of Object.entries(props)) {
    let value = lookup(input, prop);
    if (value === undefined && sub?.default !== undefined) value = sub.default;
    if (value === undefined && required.has(prop)) {
      if (!typeOf(sub) || typeOf(sub) === 'string') value = summarize(inputText);
      else missing.push(prop);
    }
    if (value !== undefined) args[prop] = coerce(value, sub);
  }
  return missing.length ? { skip: `no value for required ${missing.join(', ')}` } : { args };
}

function summarizeArgs(args) {
  return Object.entries(args || {}).slice(0, 3).map(([k, v]) => `${k}: ${typeof v === 'object' ? '…' : String(v).slice(0, 30)}`).join(', ');
}

function summarizeOutput(output) {
  if (output === null || output === undefined) return 'no output';
  if (typeof output !== 'object') return summarize(String(output));
  if (typeof output.text === 'string' && output.text) return summarize(output.text);
  const scalars = Object.entries(output).filter(([, v]) => v !== null && typeof v !== 'object').slice(0, 3);
  return scalars.length ? scalars.map(([k, v]) => `${k}: ${v}`).join(', ') : summarize(JSON.stringify(output));
}
