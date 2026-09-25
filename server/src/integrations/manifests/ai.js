import { defineIntegration } from '../defineAction.js';
import { getAgentProvider } from '../../config/agentProvider.js';
import { PermanentFailure } from '../../queue/errors.js';

/**
 * AI presets (spec/27 §4): ready-made agent calls - classify, extract,
 * summarise, draft a reply - usable as ordinary tool nodes. They are neither
 * live nor sandbox: each builds a preset system prompt and goes through
 * `getAgentProvider()`, so what actually reasons follows AGENT_PROVIDER, and the
 * node result's `mode` says which ran ('mock' | 'llm').
 */

const list = (value) => (Array.isArray(value) ? value : String(value || '').split(','))
  .map((s) => String(s).trim())
  .filter(Boolean);

const JSON_RULE = 'Respond with ONLY a single JSON object, no prose and no code fences.';

const PROMPTS = {
  classify: ({ labels, instructions }) =>
    `Classify the input into exactly one of these labels: ${labels.join(', ')}. ${instructions || ''}\n`
    + `${JSON_RULE} Shape: {"label": "<one of the labels>", "confidence": <0..1>, "reason": "<short>"}`,
  extract: ({ fields }) =>
    `Extract these fields from the input: ${fields.join(', ')}. Use null for anything absent.\n`
    + `${JSON_RULE} Shape: {${fields.map((f) => `"${f}": <value>`).join(', ')}}`,
  summarize: ({ maxWords }) =>
    `Summarise the input in at most ${maxWords} words.\n${JSON_RULE} Shape: {"summary": "<text>", "words": <count>}`,
  draft_reply: ({ tone }) =>
    `Draft a ${tone} reply to the customer message in the input.\n${JSON_RULE} Shape: {"reply": "<text>", "tone": "${tone}"}`,
};

function parseJsonReply(text) {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/**
 * The shared body of every preset. With a real model, a non-JSON answer gets
 * one retry with a stricter instruction, then fails permanently with an excerpt
 * (spec/27 edge cases) - asking a third time wouldn't change the model's mind.
 */
function preset(kind, options) {
  return async (ctx) => {
    const { params, input, logs } = ctx;
    const provider = getAgentProvider();
    const opts = options(params);
    const agentConfig = {
      label: `AI ${kind}`,
      systemPrompt: PROMPTS[kind](opts),
      preset: { kind, ...opts },
    };
    // Tells the registry which provider ran, for the node result's `mode`.
    ctx.reportMode = provider.mode;

    let result = await provider.run(agentConfig, input);
    for (const line of result.logs || []) logs.push(line);
    if (provider.mode !== 'llm') return result.output;

    let parsed = parseJsonReply(result.output?.reply);
    if (parsed === undefined) {
      logs.push(`[ai] ${kind}: reply was not JSON, retrying once with a stricter instruction`);
      result = await provider.run({ ...agentConfig, systemPrompt: `${agentConfig.systemPrompt}\nIMPORTANT: output must be valid JSON and nothing else.` }, input);
      parsed = parseJsonReply(result.output?.reply);
    }
    if (parsed === undefined) {
      throw new PermanentFailure(`AI ${kind}: the model did not return JSON ("${String(result.output?.reply || '').slice(0, 120)}")`);
    }
    return parsed;
  };
}

const common = { cacheable: false, mockBehavior: false };

export default defineIntegration({
  id: 'ai',
  name: 'AI',
  icon: 'ai',
  category: 'ai',
  description: 'Classify, extract, summarise and draft replies with the configured agent provider.',
  auth: { type: 'none', fields: [] },
  actions: [
    {
      id: 'classify',
      name: 'Classify',
      description: 'Pick one label for the input.',
      ...common,
      configSchema: [
        { key: 'labels', label: 'Labels (comma-separated)', type: 'text', required: true, placeholder: 'refund, bug, question' },
        { key: 'instructions', label: 'Extra instructions', type: 'textarea' },
      ],
      outputSample: { label: 'refund', confidence: 0.9, reason: 'input mentions "refund"' },
      sandbox: preset('classify', (p) => ({ labels: list(p.labels), instructions: p.instructions || '' })),
    },
    {
      id: 'extract',
      name: 'Extract fields',
      description: 'Pull named fields out of the input.',
      ...common,
      configSchema: [
        { key: 'fields', label: 'Fields (comma-separated)', type: 'text', required: true, placeholder: 'email, orderId, amount' },
      ],
      outputSample: { email: 'customer@example.com', orderId: '1042', amount: 49 },
      sandbox: preset('extract', (p) => ({ fields: list(p.fields) })),
    },
    {
      id: 'summarize',
      name: 'Summarise',
      description: 'Shorten the input to a few words.',
      ...common,
      configSchema: [
        { key: 'maxWords', label: 'Max words', type: 'number', default: 30 },
      ],
      outputSample: { summary: 'Customer reports order 1042 has not arrived.', words: 7 },
      sandbox: preset('summarize', (p) => ({ maxWords: Math.max(1, Number(p.maxWords) || 30) })),
    },
    {
      id: 'draft_reply',
      name: 'Draft reply',
      description: 'Write a reply to a customer message.',
      ...common,
      configSchema: [
        {
          key: 'tone', label: 'Tone', type: 'select', default: 'friendly',
          options: [{ value: 'friendly', label: 'Friendly' }, { value: 'formal', label: 'Formal' }, { value: 'apologetic', label: 'Apologetic' }],
        },
      ],
      outputSample: { reply: "Hi there, thanks for reaching out! We're on it.", tone: 'friendly' },
      sandbox: preset('draft_reply', (p) => ({ tone: p.tone || 'friendly' })),
    },
  ],
});
