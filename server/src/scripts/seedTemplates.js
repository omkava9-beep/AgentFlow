/**
 * Seeds the built-in workflow templates (spec/15).
 *
 *   npm run seed:templates
 *
 * Built-ins have `workspaceId: null`, which is what makes them visible in every workspace
 * without anyone having to create them. Re-running is safe: each template is
 * upserted by name, so the script can be used to update a built-in's graph
 * without accumulating duplicates.
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import Template from '../models/Template.js';

const node = (id, type, config, x, y) => ({ id, type, position: { x, y }, data: { config } });
const edge = (source, target, extra = {}) => ({ id: `e-${source}-${target}`, source, target, ...extra });

const BUILT_INS = [
  {
    name: 'Summarize & Notify',
    description: 'Fetch data with a tool, summarize it with an agent, then post the result to Slack.',
    nodes: [
      node('start', 'start', { label: 'Start' }, 40, 160),
      node('search', 'tool', {
        label: 'Research',
        integration: 'builtin',
        action: 'fake-search',
        connectionId: null,
        params: { query: '{{input.topic}}', limit: 3 },
        mockOverrides: { failureRate: 0 },
      }, 220, 160),
      node('summarizer', 'agent', {
        label: 'Summarizer',
        systemPrompt: 'Summarize the search results into three concise bullet points.',
        isHandoff: false,
        candidates: [],
      }, 420, 160),
      node('notify', 'tool', {
        label: 'Notify Slack',
        // No connection: runs in sandbox until a Slack connection is picked.
        integration: 'slack',
        action: 'post_message',
        connectionId: null,
        params: { channel: '#research', text: 'New summary: {{input.reply}}' },
      }, 620, 160),
      node('end', 'end', { label: 'End' }, 820, 160),
    ],
    edges: [edge('start', 'search'), edge('search', 'summarizer'), edge('summarizer', 'notify'), edge('notify', 'end')],
  },
  {
    name: 'Triage & Route',
    description: 'A handoff agent inspects the input and routes it to the right specialist agent.',
    nodes: [
      node('start', 'start', { label: 'Start' }, 40, 200),
      node('router', 'agent', {
        label: 'Triage',
        systemPrompt: 'Decide whether this request is about billing, support, or sales.',
        isHandoff: true,
        candidates: ['billing', 'support', 'sales'],
      }, 220, 200),
      node('billing', 'agent', { label: 'Billing Agent', systemPrompt: 'Handle billing questions.', isHandoff: false, candidates: [] }, 440, 80),
      node('support', 'agent', { label: 'Support Agent', systemPrompt: 'Handle technical support questions.', isHandoff: false, candidates: [] }, 440, 200),
      node('sales', 'agent', { label: 'Sales Agent', systemPrompt: 'Handle sales enquiries.', isHandoff: false, candidates: [] }, 440, 320),
      node('reply', 'tool', {
        label: 'Send Reply',
        integration: 'email',
        action: 'send',
        connectionId: null,
        params: { to: '{{input.email}}', subject: 'Re: your request', body: '{{input.reply}}' },
      }, 660, 200),
      node('end', 'end', { label: 'End' }, 860, 200),
    ],
    edges: [
      edge('start', 'router'),
      edge('router', 'billing', { label: 'billing' }),
      edge('router', 'support', { label: 'support' }),
      edge('router', 'sales', { label: 'sales' }),
      edge('billing', 'reply'), edge('support', 'reply'), edge('sales', 'reply'),
      edge('reply', 'end'),
    ],
  },
  {
    name: 'Conditional Retry Demo',
    description: 'Shows failure injection, retry/backoff and a condition branch — useful for demoing the engine.',
    nodes: [
      node('start', 'start', { label: 'Start' }, 40, 180),
      node('flaky', 'tool', {
        label: 'Flaky API',
        integration: 'builtin',
        action: 'fake-weather',
        connectionId: null,
        params: { city: 'Lisbon' },
        // Fails often enough that retry/backoff is visible on a single run.
        mockOverrides: { failureRate: 0.6, maxAttempts: 5 },
      }, 220, 180),
      node('check', 'condition', { label: 'Warm?', expression: 'output.tempC > 20' }, 420, 180),
      node('warm', 'agent', { label: 'Warm Advice', systemPrompt: 'Suggest an outdoor activity.', isHandoff: false, candidates: [] }, 620, 90),
      node('cold', 'agent', { label: 'Cold Advice', systemPrompt: 'Suggest an indoor activity.', isHandoff: false, candidates: [] }, 620, 270),
      node('end', 'end', { label: 'End' }, 840, 180),
    ],
    edges: [
      edge('start', 'flaky'),
      edge('flaky', 'check'),
      { id: 'e-check-warm', source: 'check', target: 'warm', sourceHandle: 'true', label: 'true' },
      { id: 'e-check-cold', source: 'check', target: 'cold', sourceHandle: 'false', label: 'false' },
      edge('warm', 'end'), edge('cold', 'end'),
    ],
  },
];

async function main() {
  await mongoose.connect(env.mongodbUri);

  for (const template of BUILT_INS) {
    const result = await Template.findOneAndUpdate(
      { workspaceId: null, name: template.name },
      { $set: { ...template, workspaceId: null, createdBy: null } },
      // `returnDocument: 'after'` rather than `new: true` - the latter is
      // deprecated in this Mongoose version and warns on every call.
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    console.log(`  seeded "${result.name}" (${result.nodes.length} nodes, ${result.edges.length} edges)`);
  }

  const total = await Template.countDocuments({ workspaceId: null });
  console.log(`${BUILT_INS.length} built-in template(s) upserted; ${total} now in the database.`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Failed to seed templates:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
