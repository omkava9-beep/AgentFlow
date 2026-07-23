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
export class MockAgentProvider {
  async run(agentConfig, input) {
    const latency = 300 + Math.random() * 700;
    await delay(latency);

    if (Math.random() < 0.05) {
      throw new Error(`Mock agent "${agentConfig.label}" failed to produce a response`);
    }

    const inputText = typeof input === 'string' ? input : JSON.stringify(input ?? {});
    const logs = [`[mock-agent] ${agentConfig.label} received input`, `[mock-agent] system prompt: "${summarize(agentConfig.systemPrompt)}"`];

    if (agentConfig.isHandoff) {
      const candidates = agentConfig.candidates || [];
      const lower = inputText.toLowerCase();
      const matched = candidates.find((c) => lower.includes(c.toLowerCase()));
      const handoffTarget = matched || candidates[Math.floor(Math.random() * candidates.length)] || null;
      logs.push(`[mock-agent] handoff decision -> ${handoffTarget}`);
      return { output: { handoffTarget, reason: `routed based on keyword match in input` }, logs, handoffTarget };
    }

    const output = {
      reply: `${agentConfig.label || 'Agent'} processed: ${summarize(inputText)}`,
      basedOn: agentConfig.systemPrompt ? summarize(agentConfig.systemPrompt) : null,
    };
    return { output, logs };
  }
}
