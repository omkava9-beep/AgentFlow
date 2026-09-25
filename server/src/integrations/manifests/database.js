import { defineIntegration } from '../defineAction.js';
import { PermanentFailure } from '../../queue/errors.js';

/**
 * "Real, contained": the per-workspace sandbox store *is* the database, so
 * there's no live adapter and no external call. Writes are genuinely stored and
 * readable by later nodes or runs.
 */
export default defineIntegration({
  id: 'database',
  name: 'Database',
  icon: 'database',
  category: 'data',
  description: 'A per-workspace document store: insert, find and update records.',
  auth: { type: 'none', fields: [] },
  actions: [
    {
      id: 'insert',
      name: 'Insert record',
      description: 'Insert a document. Leave the document empty to store the node\'s input.',
      sideEffect: true,
      configSchema: [
        { key: 'collection', label: 'Collection', type: 'text', required: true, placeholder: 'orders' },
        { key: 'document', label: 'Document (JSON)', type: 'json', placeholder: '{ "id": "{{input.orderId}}" }' },
      ],
      outputSample: { inserted: true, collection: 'orders', id: '66f0c0ffee0000000000abcd' },
      sandbox: async ({ params, input, sandbox, logs }) => {
        const document = params.document ?? input ?? {};
        if (typeof document !== 'object' || Array.isArray(document)) {
          throw new PermanentFailure('Database insert needs a JSON object document');
        }
        const record = await sandbox.insert(params.collection, document);
        // recordId, not id: a document may carry its own `id` field.
        logs.push(`[database] inserted into "${params.collection}" as ${record.recordId}`);
        return { inserted: true, collection: params.collection, id: record.recordId };
      },
    },
    {
      id: 'find',
      name: 'Find records',
      description: 'Find documents by exact field values.',
      // Reads a store that other nodes write to: caching it would serve stale rows.
      cacheable: false,
      configSchema: [
        { key: 'collection', label: 'Collection', type: 'text', required: true, placeholder: 'orders' },
        { key: 'filter', label: 'Filter (JSON)', type: 'json', placeholder: '{ "status": "open" }' },
        { key: 'limit', label: 'Limit', type: 'number', default: 50 },
      ],
      outputSample: { collection: 'orders', count: 1, records: [{ id: '66f0c0ffee0000000000abcd', status: 'open' }] },
      sandbox: async ({ params, sandbox }) => {
        const records = await sandbox.find(params.collection, params.filter || {}, { limit: params.limit });
        return { collection: params.collection, count: records.length, records };
      },
    },
    {
      id: 'update',
      name: 'Update record',
      description: 'Set fields on one record by id.',
      sideEffect: true,
      configSchema: [
        { key: 'collection', label: 'Collection', type: 'text', required: true, placeholder: 'orders' },
        { key: 'id', label: 'Record id', type: 'text', required: true, placeholder: '{{input.id}}' },
        { key: 'patch', label: 'Patch (JSON)', type: 'json', required: true, placeholder: '{ "status": "closed" }' },
      ],
      outputSample: { updated: true, collection: 'orders', record: { id: '66f0c0ffee0000000000abcd', status: 'closed' } },
      sandbox: async ({ params, sandbox }) => {
        const record = await sandbox.update(params.collection, params.id, params.patch);
        return { updated: true, collection: params.collection, record };
      },
    },
  ],
});
