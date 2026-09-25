import { defineIntegration } from '../defineAction.js';

/**
 * The three phase-2 demo tools, unchanged apart from their new home: no
 * credentials, sandbox only, cacheable (they're read-like).
 */
export default defineIntegration({
  id: 'builtin',
  name: 'Built-in demo',
  icon: 'sparkles',
  category: 'utility',
  description: 'Simulated demo tools: weather, calculator and search.',
  auth: { type: 'none', fields: [] },
  actions: [
    {
      id: 'fake-weather',
      name: 'Fake Weather',
      description: 'Simulated weather lookup for a city.',
      configSchema: [
        { key: 'city', label: 'City', type: 'text', placeholder: 'defaults to input.city' },
      ],
      outputSample: { city: 'Oslo', tempC: 18, condition: 'cloudy' },
      sandbox: ({ params, input }) => {
        const temps = [12, 18, 21, 25, 30, 8];
        const conditions = ['sunny', 'cloudy', 'rainy', 'windy'];
        return {
          city: params.city || input?.city || 'Unknown City',
          tempC: temps[Math.floor(Math.random() * temps.length)],
          condition: conditions[Math.floor(Math.random() * conditions.length)],
        };
      },
    },
    {
      id: 'calculator',
      name: 'Calculator',
      description: 'Evaluates a simple arithmetic expression.',
      configSchema: [
        { key: 'expression', label: 'Expression', type: 'text', placeholder: 'defaults to input.expression' },
      ],
      outputSample: { expression: '2+2', result: 4 },
      sandbox: ({ params, input }) => {
        const expr = String(params.expression || input?.expression || '1+1');
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
    },
    {
      id: 'fake-search',
      name: 'Fake Search',
      description: 'Simulated search returning canned results.',
      configSchema: [
        { key: 'query', label: 'Query', type: 'text', placeholder: 'defaults to input.query' },
        { key: 'limit', label: 'Results', type: 'number', default: 2 },
      ],
      outputSample: { query: 'agents', results: [{ title: 'Result A for "agents"', snippet: 'Simulated search result snippet.' }] },
      sandbox: ({ params, input }) => {
        const query = params.query || input?.query || '';
        const limit = Math.max(1, Math.min(5, Number(params.limit) || 2));
        return {
          query,
          results: Array.from({ length: limit }, (_, i) => ({
            title: `Result ${String.fromCharCode(65 + i)} for "${query}"`,
            snippet: 'Simulated search result snippet.',
          })),
        };
      },
    },
  ],
});
