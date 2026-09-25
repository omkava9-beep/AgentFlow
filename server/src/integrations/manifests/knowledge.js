import { defineIntegration } from '../defineAction.js';
import { searchKnowledge } from '../../services/knowledgeBase.js';

/**
 * Knowledge Base search (spec/27 §7). Real and in-process, so there's nothing
 * to be "live" against: the one implementation runs in both modes.
 *
 * Not cacheable, a deliberate deviation from spec/27's table: the tool cache
 * key can't see the index, so a cached answer would survive a document upload
 * for the cache TTL and the node would miss what was just added.
 */
const search = async ({ params, workspaceId, logs }) => {
  const results = await searchKnowledge(workspaceId, params.query, { topK: params.topK });
  logs.push(`[knowledge] "${String(params.query).slice(0, 60)}" → ${results.length} chunk(s)`);
  return { query: params.query, results };
};

export default defineIntegration({
  id: 'knowledge',
  name: 'Knowledge Base',
  icon: 'knowledge',
  category: 'ai',
  description: "Search this workspace's uploaded documents (TF-IDF, in process).",
  auth: { type: 'none', fields: [] },
  actions: [
    {
      id: 'search',
      name: 'Search',
      description: 'Return the most relevant chunks for a query.',
      cacheable: false,
      configSchema: [
        { key: 'query', label: 'Query', type: 'text', required: true, placeholder: 'Supports {{input.field}}' },
        { key: 'topK', label: 'Results', type: 'number', default: 3 },
      ],
      outputSample: { query: 'refund policy', results: [{ docId: '…', title: 'Refunds', chunk: 'Refunds are issued within 5 business days…', score: 0.61 }] },
      // Knowledge is real either way, so sandbox and live are the same
      // function - and the index is in process, so mock latency and injected
      // failures would only make it look flaky.
      mockBehavior: false,
      sandbox: search,
    },
  ],
});
