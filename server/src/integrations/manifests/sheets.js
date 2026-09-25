import { defineIntegration } from '../defineAction.js';
import { PermanentFailure } from '../../queue/errors.js';
import { genericInbound } from '../inboundUtil.js';

const HEADER = ['Date', 'Customer', 'Amount', 'Status'];
const FIXTURE_ROWS = [
  ['2026-09-01', 'Northwind Traders', 1250, 'Paid'],
  ['2026-09-03', 'Contoso Ltd', 480, 'Paid'],
  ['2026-09-08', 'Fabrikam Inc', 2200, 'Overdue'],
  ['2026-09-12', 'Tailspin Toys', 95, 'Paid'],
  ['2026-09-19', 'Adventure Works', 760, 'Pending'],
];

const sheetKey = (spreadsheet, sheet) => `${spreadsheet}:${sheet}`;

function target(params) {
  const spreadsheet = String(params.spreadsheet || '').trim();
  if (!spreadsheet) throw new PermanentFailure('A spreadsheet is required');
  return { spreadsheet, sheet: String(params.sheet || 'Sheet1').trim() || 'Sheet1' };
}

function valuesOf(value) {
  if (!Array.isArray(value)) throw new PermanentFailure('Values must be a JSON array, e.g. ["2026-09-25", "Acme", 120]');
  return value;
}

/** Row 1 is the header and rows 2–6 the fixtures, like a sheet someone already uses. */
async function ensureSheet(sandbox, { spreadsheet, sheet }) {
  await sandbox.seedOnce(`sheet:${sheetKey(spreadsheet, sheet)}`, 'rows', [HEADER, ...FIXTURE_ROWS].map((values, i) => ({
    spreadsheet, sheet, row: i + 1, values,
  })));
}

export default defineIntegration({
  id: 'sheets',
  name: 'Google Sheets',
  icon: 'sheet',
  category: 'data',
  description: 'Append, read and update spreadsheet rows (sandbox).',
  auth: {
    type: 'apiKey',
    fields: [{ key: 'apiKey', label: 'API key', type: 'text', required: true, secret: true }],
  },
  actions: [
    {
      id: 'append_row',
      name: 'Append row',
      sideEffect: true,
      configSchema: [
        { key: 'spreadsheet', label: 'Spreadsheet', type: 'text', required: true, placeholder: 'Sales 2026' },
        { key: 'sheet', label: 'Sheet', type: 'text', default: 'Sheet1' },
        { key: 'values', label: 'Values (JSON array)', type: 'json', required: true, placeholder: '["{{input.date}}", "{{input.customer}}", {{input.amount}}]' },
      ],
      outputSample: { spreadsheet: 'Sales 2026', sheet: 'Sheet1', row: 7, values: ['2026-09-25', 'Acme', 120] },
      sandbox: async ({ params, sandbox }) => {
        const where = target(params);
        const values = valuesOf(params.values);
        await ensureSheet(sandbox, where);
        const row = await sandbox.nextNumber(`rows:${sheetKey(where.spreadsheet, where.sheet)}`, { after: FIXTURE_ROWS.length + 1 });
        await sandbox.insert('rows', { ...where, row, values });
        return { ...where, row, values };
      },
    },
    {
      id: 'read_rows',
      name: 'Read rows',
      cacheable: true,
      configSchema: [
        { key: 'spreadsheet', label: 'Spreadsheet', type: 'text', required: true, placeholder: 'Sales 2026' },
        { key: 'sheet', label: 'Sheet', type: 'text', default: 'Sheet1' },
        { key: 'limit', label: 'Max rows', type: 'number', default: 100 },
      ],
      outputSample: { spreadsheet: 'Sales 2026', sheet: 'Sheet1', header: HEADER, count: 1, rows: [{ row: 2, values: FIXTURE_ROWS[0] }] },
      sandbox: async ({ params, sandbox }) => {
        const where = target(params);
        await ensureSheet(sandbox, where);
        const all = await sandbox.find('rows', where, { limit: 200, sort: { 'doc.row': 1 } });
        const header = all.find((r) => r.row === 1)?.values || [];
        const rows = all.filter((r) => r.row > 1).slice(0, Math.max(1, Number(params.limit) || 100)).map((r) => ({ row: r.row, values: r.values }));
        return { ...where, header, count: rows.length, rows };
      },
    },
    {
      id: 'update_row',
      name: 'Update row',
      sideEffect: true,
      configSchema: [
        { key: 'spreadsheet', label: 'Spreadsheet', type: 'text', required: true },
        { key: 'sheet', label: 'Sheet', type: 'text', default: 'Sheet1' },
        { key: 'row', label: 'Row number', type: 'number', required: true },
        { key: 'values', label: 'Values (JSON array)', type: 'json', required: true },
      ],
      outputSample: { updated: true, spreadsheet: 'Sales 2026', sheet: 'Sheet1', row: 4, values: ['2026-09-08', 'Fabrikam Inc', 2200, 'Paid'] },
      sandbox: async ({ params, sandbox }) => {
        const where = target(params);
        const values = valuesOf(params.values);
        await ensureSheet(sandbox, where);
        const row = Number(params.row);
        const existing = await sandbox.findOne('rows', { ...where, row });
        if (!existing) throw new PermanentFailure(`Row ${row} is empty in ${where.spreadsheet} / ${where.sheet}`);
        await sandbox.update('rows', existing.recordId, { values });
        return { updated: true, ...where, row, values };
      },
    },
  ],
  triggers: [
    {
      id: 'row_added',
      name: 'Row added',
      description: 'A row was added to a sheet.',
      samplePayload: { spreadsheet: 'Leads', sheet: 'Sheet1', row: 14, values: ['2026-09-25', 'Globex', 'demo request'] },
    },
  ],
  inbound: genericInbound(['row_added']),
});
