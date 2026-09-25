import { defineIntegration } from '../defineAction.js';
import { PermanentFailure } from '../../queue/errors.js';
import { airtableId } from '../ids.js';
import { genericInbound } from '../inboundUtil.js';

const FIXTURES = [
  { Name: 'Northwind Traders', Stage: 'Customer', Seats: 40 },
  { Name: 'Globex', Stage: 'Trial', Seats: 12 },
  { Name: 'Initech', Stage: 'Lead', Seats: 5 },
];

function tableOf(params) {
  const base = String(params.base || '').trim();
  const table = String(params.table || '').trim();
  if (!base || !table) throw new PermanentFailure('Base and table are required');
  return { base, table };
}

const present = (r) => ({ id: r.id, createdTime: r.createdTime, fields: r.fields });

async function ensureTable(sandbox, { base, table }) {
  await sandbox.seedOnce(`table:${base}:${table}`, 'records', FIXTURES.map((fields, i) => ({
    id: airtableId(), base, table, fields, createdTime: new Date(Date.now() - (FIXTURES.length - i) * 86_400_000).toISOString(),
  })));
}

export default defineIntegration({
  id: 'airtable',
  name: 'Airtable',
  icon: 'table',
  category: 'data',
  description: 'Create and list table records (sandbox).',
  auth: {
    type: 'bearer',
    fields: [{ key: 'token', label: 'Personal access token', type: 'text', required: true, secret: true, placeholder: 'pat…' }],
  },
  actions: [
    {
      id: 'create_record',
      name: 'Create record',
      sideEffect: true,
      configSchema: [
        { key: 'base', label: 'Base', type: 'text', required: true, placeholder: 'CRM' },
        { key: 'table', label: 'Table', type: 'text', required: true, placeholder: 'Accounts' },
        { key: 'fields', label: 'Fields (JSON)', type: 'json', required: true, placeholder: '{ "Name": "{{input.company}}" }' },
      ],
      outputSample: { id: 'recA1b2C3d4E5f6G7', createdTime: '2026-09-25T10:00:00.000Z', fields: { Name: 'Acme' } },
      sandbox: async ({ params, sandbox }) => {
        const where = tableOf(params);
        if (!params.fields || typeof params.fields !== 'object' || Array.isArray(params.fields)) {
          throw new PermanentFailure('Fields must be a JSON object');
        }
        await ensureTable(sandbox, where);
        const record = { id: airtableId(), ...where, fields: params.fields, createdTime: new Date().toISOString() };
        await sandbox.insert('records', record);
        return present(record);
      },
    },
    {
      id: 'list_records',
      name: 'List records',
      cacheable: false, // create_record writes to the same table
      configSchema: [
        { key: 'base', label: 'Base', type: 'text', required: true, placeholder: 'CRM' },
        { key: 'table', label: 'Table', type: 'text', required: true, placeholder: 'Accounts' },
      ],
      outputSample: { count: 1, records: [{ id: 'recA1b2C3d4E5f6G7', createdTime: '2026-09-25T10:00:00.000Z', fields: { Name: 'Acme' } }] },
      sandbox: async ({ params, sandbox }) => {
        const where = tableOf(params);
        await ensureTable(sandbox, where);
        const records = (await sandbox.find('records', where, { limit: 100 })).map(present);
        return { ...where, count: records.length, records };
      },
    },
  ],
  triggers: [
    {
      id: 'record_created',
      name: 'Record created',
      description: 'A record was created in a table.',
      samplePayload: { base: 'CRM', table: 'Accounts', id: 'recZ9y8X7w6V5u4T3', fields: { Name: 'Umbrella Corp', Stage: 'Lead' } },
    },
  ],
  inbound: genericInbound(['record_created']),
});
