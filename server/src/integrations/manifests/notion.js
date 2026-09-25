import { defineIntegration } from '../defineAction.js';
import { PermanentFailure } from '../../queue/errors.js';
import { uuid } from '../ids.js';

const FIXTURES = [
  { title: 'Q4 launch checklist', properties: { Status: 'In progress', Owner: 'Maya' } },
  { title: 'Customer interview notes — Contoso', properties: { Status: 'Done', Owner: 'Jonas' } },
  { title: 'Pricing page experiment', properties: { Status: 'Not started', Owner: 'Priya' } },
];

const pageUrl = (title, id) => `https://www.notion.so/${encodeURIComponent(String(title).replace(/\s+/g, '-'))}-${id.replace(/-/g, '')}`;

function databaseOf(value) {
  const database = String(value || '').trim();
  if (!database) throw new PermanentFailure('A database is required');
  return database;
}

function objectOf(value, what) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new PermanentFailure(`${what} must be a JSON object`);
  return value;
}

async function ensureDatabase(sandbox, database) {
  await sandbox.seedOnce(`db:${database}`, 'pages', FIXTURES.map((f) => {
    const id = uuid();
    return { id, database, title: f.title, properties: f.properties, url: pageUrl(f.title, id) };
  }));
}

export default defineIntegration({
  id: 'notion',
  name: 'Notion',
  icon: 'notion',
  category: 'data',
  description: 'Create and query database pages (sandbox).',
  auth: {
    type: 'bearer',
    fields: [{ key: 'token', label: 'Integration token', type: 'text', required: true, secret: true, placeholder: 'secret_…' }],
  },
  actions: [
    {
      id: 'create_page',
      name: 'Create page',
      sideEffect: true,
      configSchema: [
        { key: 'database', label: 'Database', type: 'text', required: true, placeholder: 'Projects' },
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'properties', label: 'Properties (JSON)', type: 'json', placeholder: '{ "Status": "In progress" }' },
      ],
      outputSample: { id: '7c1e3b2a-5d4f-4e6a-9b8c-0d1e2f3a4b5c', url: 'https://www.notion.so/Launch-plan-7c1e3b2a5d4f4e6a9b8c0d1e2f3a4b5c', title: 'Launch plan' },
      sandbox: async ({ params, sandbox }) => {
        const database = databaseOf(params.database);
        await ensureDatabase(sandbox, database);
        const id = uuid();
        const page = { id, database, title: params.title, properties: objectOf(params.properties, 'Properties'), url: pageUrl(params.title, id) };
        await sandbox.insert('pages', page);
        return { id, url: page.url, title: page.title };
      },
    },
    {
      id: 'query_database',
      name: 'Query database',
      cacheable: false, // pages are written by create_page in the same workspace
      configSchema: [
        { key: 'database', label: 'Database', type: 'text', required: true, placeholder: 'Projects' },
        { key: 'filter', label: 'Property filter (JSON)', type: 'json', placeholder: '{ "Status": "Done" }' },
      ],
      outputSample: { database: 'Projects', count: 1, results: [{ id: '7c1e3b2a-5d4f-4e6a-9b8c-0d1e2f3a4b5c', title: 'Q4 launch checklist', properties: { Status: 'In progress' }, url: 'https://www.notion.so/…' }] },
      sandbox: async ({ params, sandbox }) => {
        const database = databaseOf(params.database);
        await ensureDatabase(sandbox, database);
        const filter = objectOf(params.filter, 'Filter');
        const pages = await sandbox.find('pages', { database }, { limit: 200 });
        // Property equality, evaluated here rather than handed to Mongo: the
        // filter is user-typed JSON and must never become a query operator.
        const results = pages
          .filter((p) => Object.entries(filter).every(([k, v]) => p.properties?.[k] === v))
          .map((p) => ({ id: p.id, title: p.title, properties: p.properties, url: p.url }));
        return { database, count: results.length, results };
      },
    },
  ],
});
