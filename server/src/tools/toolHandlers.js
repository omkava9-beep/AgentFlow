import { env } from '../config/env.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class SimulatedToolFailure extends Error {}

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

export const TOOL_HANDLERS = {
  'fake-weather': {
    label: 'Fake Weather',
    async run(config, input) {
      const output = await withMockBehavior(config, () => {
        const temps = [12, 18, 21, 25, 30, 8];
        const conditions = ['sunny', 'cloudy', 'rainy', 'windy'];
        return {
          city: (input && input.city) || 'Unknown City',
          tempC: temps[Math.floor(Math.random() * temps.length)],
          condition: conditions[Math.floor(Math.random() * conditions.length)],
        };
      });
      return { output };
    },
  },
  calculator: {
    label: 'Calculator',
    async run(config, input) {
      const output = await withMockBehavior(config, () => {
        const expr = (input && input.expression) || '1+1';
        let result;
        try {
          if (!/^[\d\s+\-*/().]+$/.test(expr)) throw new Error('unsafe expression');
          // eslint-disable-next-line no-new-func
          result = Function(`"use strict"; return (${expr});`)();
        } catch {
          result = null;
        }
        return { expression: expr, result };
      });
      return { output };
    },
  },
  'fake-search': {
    label: 'Fake Search',
    async run(config, input) {
      const output = await withMockBehavior(config, () => {
        const query = (input && input.query) || '';
        return {
          query,
          results: [
            { title: `Result A for "${query}"`, snippet: 'Simulated search result snippet.' },
            { title: `Result B for "${query}"`, snippet: 'Another simulated search result snippet.' },
          ],
        };
      });
      return { output };
    },
  },
};

export { SimulatedToolFailure };
