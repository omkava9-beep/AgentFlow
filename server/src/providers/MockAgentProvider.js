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

    // Tagged like the tool handlers' failures so the UI reads it as intentional
    // rather than as a bug. Agent nodes get no configurable dial (spec/17) - this
    // small fixed chance just keeps agent retries exercised too.
    if (Math.random() < 0.05) {
      throw new Error(`[simulated failure] mock agent "${agentConfig.label}" failed to produce a response`);
    }

    const inputText = typeof input === 'string' ? input : JSON.stringify(input ?? {});
    const logs = [`[mock-agent] ${agentConfig.label} received input`, `[mock-agent] system prompt: "${summarize(agentConfig.systemPrompt)}"`];

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
}
