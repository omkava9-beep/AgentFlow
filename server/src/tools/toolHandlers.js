import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { PermanentFailure } from '../queue/errors.js';
import { interpolateConfig } from './template.js';
import MockRecord from '../models/MockRecord.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class SimulatedToolFailure extends Error {}

/**
 * Every handler goes through here, so all of them inherit artificial latency,
 * spec/17's failure injection and spec/07's retry/backoff for free.
 */
async function withMockBehavior(config, produce) {
  const [minLatency, maxLatency] = config?.mockOverrides?.latencyMs || [200, 900];
  const latency = minLatency + Math.random() * (maxLatency - minLatency);
  await delay(latency);

  const failureRate = config?.mockOverrides?.failureRate ?? env.defaultToolFailureRate;
  if (Math.random() < failureRate) {
    throw new SimulatedToolFailure(`[simulated failure] ${config.toolType} call failed`);
  }
  return produce();
}

/**
 * Wraps a handler body so each one only has to describe its own output:
 * interpolation of `{{input.x}}` placeholders, mock behavior and log collection
 * are handled once here rather than repeated seven times.
 */
function defineTool({ label, description, configSchema = [], cacheable = true, run }) {
  return {
    label,
    description,
    configSchema,
    // Caching an action tool would mean the second "send" silently doesn't
    // happen, so side-effecting tools opt out. See spec/21.
    cacheable,
    async run(config, input, context = {}) {
      const logs = [];
      const toolConfig = interpolateConfig(config?.toolConfig || {}, input, logs);
      const output = await withMockBehavior(config, () => run({ toolConfig, input, context, logs }));
      const resolved = await output;
      return { output: resolved, logs };
    },
  };
}

let messageCounter = 0;
const nextMockId = (prefix) => `${prefix}-${Date.now().toString(36)}-${++messageCounter}`;

export const TOOL_HANDLERS = {
  'fake-weather': defineTool({
    label: 'Fake Weather',
    description: 'Simulated weather lookup for a city.',
    configSchema: [
      { key: 'city', label: 'City', type: 'text', placeholder: 'defaults to input.city' },
    ],
    run: ({ toolConfig, input }) => {
      const temps = [12, 18, 21, 25, 30, 8];
      const conditions = ['sunny', 'cloudy', 'rainy', 'windy'];
      return {
        city: toolConfig.city || input?.city || 'Unknown City',
        tempC: temps[Math.floor(Math.random() * temps.length)],
        condition: conditions[Math.floor(Math.random() * conditions.length)],
      };
    },
  }),

  calculator: defineTool({
    label: 'Calculator',
    description: 'Evaluates a simple arithmetic expression.',
    configSchema: [
      { key: 'expression', label: 'Expression', type: 'text', placeholder: 'defaults to input.expression' },
    ],
    run: ({ toolConfig, input }) => {
      const expr = toolConfig.expression || input?.expression || '1+1';
      let result;
      try {
        if (!/^[\d\s+\-*/().]+$/.test(expr)) throw new Error('unsafe expression');
        // eslint-disable-next-line no-new-func
        result = Function(`"use strict"; return (${expr});`)();
      } catch {
        result = null;
      }
      return { expression: expr, result };
    },
  }),

  'fake-search': defineTool({
    label: 'Fake Search',
    description: 'Simulated search returning canned results.',
    configSchema: [
      { key: 'query', label: 'Query', type: 'text', placeholder: 'defaults to input.query' },
      { key: 'limit', label: 'Results', type: 'number', default: 2 },
    ],
    run: ({ toolConfig, input }) => {
      const query = toolConfig.query || input?.query || '';
      const limit = Math.max(1, Math.min(5, Number(toolConfig.limit) || 2));
      return {
        query,
        results: Array.from({ length: limit }, (_, i) => ({
          title: `Result ${String.fromCharCode(65 + i)} for "${query}"`,
          snippet: 'Simulated search result snippet.',
        })),
      };
    },
  }),

  'send-email': defineTool({
    label: 'Send Email',
    description: 'Simulated email send. Nothing leaves the machine.',
    cacheable: false,
    configSchema: [
      { key: 'to', label: 'To', type: 'text', required: true, placeholder: 'someone@example.com' },
      { key: 'subject', label: 'Subject', type: 'text', default: '(no subject)' },
      { key: 'body', label: 'Body', type: 'textarea', placeholder: 'Supports {{input.field}}' },
    ],
    run: ({ toolConfig, logs }) => {
      if (!toolConfig.to) throw new PermanentFailure('send-email requires a "To" address');
      logs.push(`[send-email] simulated delivery to ${toolConfig.to}`);
      return {
        delivered: true,
        to: toolConfig.to,
        subject: toolConfig.subject || '(no subject)',
        body: toolConfig.body || '',
        messageId: nextMockId('mock'),
      };
    },
  }),

  'slack-message': defineTool({
    label: 'Slack Message',
    description: 'Simulated Slack post. Nothing leaves the machine.',
    cacheable: false,
    configSchema: [
      { key: 'channel', label: 'Channel', type: 'text', required: true, placeholder: '#general' },
      { key: 'text', label: 'Text', type: 'textarea', placeholder: 'Supports {{input.field}}' },
    ],
    run: ({ toolConfig, logs }) => {
      if (!toolConfig.channel) throw new PermanentFailure('slack-message requires a channel');
      logs.push(`[slack-message] simulated post to ${toolConfig.channel}`);
      return {
        posted: true,
        channel: toolConfig.channel,
        text: toolConfig.text || '',
        ts: `${Math.floor(Date.now() / 1000)}.${String(messageCounter).padStart(6, '0')}`,
      };
    },
  }),

  'http-request': defineTool({
    label: 'HTTP Request',
    description: 'Simulated HTTP call — no real network request is made.',
    cacheable: false,
    configSchema: [
      { key: 'url', label: 'URL', type: 'text', required: true, placeholder: 'https://api.example.com/things' },
      {
        key: 'method', label: 'Method', type: 'select', default: 'GET',
        options: [
          { value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' },
          { value: 'PUT', label: 'PUT' }, { value: 'PATCH', label: 'PATCH' }, { value: 'DELETE', label: 'DELETE' },
        ],
      },
      { key: 'body', label: 'Request body', type: 'textarea', placeholder: 'Supports {{input.field}}' },
    ],
    // DELIBERATELY MOCKED - not unfinished. A tool node performing real outbound
    // HTTP to a user-supplied URL is a server-side request forgery primitive: any
    // logged-in user could point it at an internal address and read the response
    // back through the run log. It would also make demo runs depend on network
    // reachability and would be this project's first real external dependency,
    // which CLAUDE.md rules out. See spec/21.
    run: ({ toolConfig, input, logs }) => {
      if (!toolConfig.url) throw new PermanentFailure('http-request requires a URL');
      const method = (toolConfig.method || 'GET').toUpperCase();
      logs.push(`[http-request] simulated ${method} ${toolConfig.url} (no real network call)`);
      return {
        simulated: true,
        status: 200,
        url: toolConfig.url,
        method,
        body: toolConfig.body || (input ? { echo: input } : null),
      };
    },
  }),

  'database-write': defineTool({
    label: 'Database Write',
    description: 'Inserts a document into a scratch MockRecord collection.',
    cacheable: false,
    configSchema: [
      { key: 'collection', label: 'Collection', type: 'text', required: true, placeholder: 'orders' },
      { key: 'document', label: 'Document (JSON)', type: 'textarea', placeholder: '{ "id": "{{input.orderId}}" }' },
    ],
    run: async ({ toolConfig, input, context, logs }) => {
      if (!toolConfig.collection) throw new PermanentFailure('database-write requires a collection name');

      let document;
      if (!toolConfig.document || !String(toolConfig.document).trim()) {
        document = input ?? {};
      } else {
        try {
          document = JSON.parse(toolConfig.document);
        } catch (err) {
          // Permanent on purpose: malformed JSON will never parse, so retrying it
          // three times just burns the node's attempts.
          throw new PermanentFailure(`database-write got invalid JSON: ${err.message}`);
        }
      }

      const record = await MockRecord.create({
        ownerId: context.ownerId,
        runId: mongoose.isValidObjectId(context.runId) ? context.runId : undefined,
        collectionName: toolConfig.collection,
        document,
      });
      logs.push(`[database-write] inserted into "${toolConfig.collection}" as ${record._id}`);
      return { inserted: true, collection: toolConfig.collection, id: record._id.toString() };
    },
  }),
};

export { SimulatedToolFailure };
