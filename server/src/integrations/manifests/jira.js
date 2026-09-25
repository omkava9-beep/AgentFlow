import { defineIntegration } from '../defineAction.js';
import { PermanentFailure } from '../../queue/errors.js';
import { genericInbound } from '../inboundUtil.js';

const STATUSES = ['To Do', 'In Progress', 'In Review', 'Done'];
const PROJECT_RE = /^[A-Z][A-Z0-9]{1,9}$/;

const FIXTURES = [
  { summary: 'Customers report duplicate charge emails', type: 'Bug', status: 'In Progress' },
  { summary: 'Update refund policy copy on checkout', type: 'Task', status: 'To Do' },
  { summary: 'Add CSV export to the orders report', type: 'Story', status: 'To Do' },
];

function projectOf(value) {
  const project = String(value || 'WEB').trim().toUpperCase();
  if (!PROJECT_RE.test(project)) throw new PermanentFailure(`"${project}" isn't a Jira project key (2–10 capitals, e.g. WEB)`);
  return project;
}

const siteOf = (connection) => String(connection?.config?.site || 'acme.atlassian.net').replace(/^https?:\/\//, '').replace(/\/+$/, '');

/** Per-project ticket numbers (`WEB-4`), continuing after the fixtures. */
async function ensureProject(sandbox, project, site) {
  await sandbox.seedOnce(`project:${project}`, 'tickets', FIXTURES.map((f, i) => ({
    key: `${project}-${i + 1}`,
    project,
    summary: f.summary,
    type: f.type,
    status: f.status,
    url: `https://${site}/browse/${project}-${i + 1}`,
  })));
}

export default defineIntegration({
  id: 'jira',
  name: 'Jira',
  icon: 'jira',
  category: 'developer',
  description: 'Create and move tickets (sandbox).',
  auth: {
    type: 'basic',
    fields: [
      { key: 'site', label: 'Site', type: 'text', required: true, placeholder: 'acme.atlassian.net' },
      { key: 'email', label: 'Account email', type: 'text', required: true },
      { key: 'apiToken', label: 'API token', type: 'text', required: true, secret: true },
    ],
  },
  actions: [
    {
      id: 'create_ticket',
      name: 'Create ticket',
      sideEffect: true,
      configSchema: [
        { key: 'project', label: 'Project key', type: 'text', required: true, default: 'WEB' },
        { key: 'summary', label: 'Summary', type: 'text', required: true },
        { key: 'type', label: 'Type', type: 'select', default: 'Task', options: ['Task', 'Bug', 'Story'].map((t) => ({ value: t, label: t })) },
      ],
      outputSample: { key: 'WEB-4', url: 'https://acme.atlassian.net/browse/WEB-4', status: 'To Do' },
      sandbox: async ({ params, connection, sandbox }) => {
        const project = projectOf(params.project);
        const site = siteOf(connection);
        await ensureProject(sandbox, project, site);
        const n = await sandbox.nextNumber(`tickets:${project}`, { after: FIXTURES.length });
        const key = `${project}-${n}`;
        const url = `https://${site}/browse/${key}`;
        await sandbox.insert('tickets', { key, project, summary: params.summary, type: params.type || 'Task', status: 'To Do', url });
        return { key, url, status: 'To Do' };
      },
    },
    {
      id: 'transition_ticket',
      name: 'Transition ticket',
      sideEffect: true,
      configSchema: [
        { key: 'key', label: 'Ticket key', type: 'text', required: true, placeholder: 'WEB-4' },
        { key: 'status', label: 'Move to', type: 'select', required: true, default: 'In Progress', options: STATUSES.map((s) => ({ value: s, label: s })) },
      ],
      outputSample: { key: 'WEB-4', from: 'To Do', to: 'In Progress' },
      sandbox: async ({ params, connection, sandbox }) => {
        const key = String(params.key || '').trim().toUpperCase();
        const project = projectOf(key.split('-')[0]);
        await ensureProject(sandbox, project, siteOf(connection));
        if (!STATUSES.includes(params.status)) throw new PermanentFailure(`Unknown status "${params.status}"`);
        const ticket = await sandbox.findOne('tickets', { key });
        if (!ticket) throw new PermanentFailure(`Issue ${key} does not exist`);
        await sandbox.update('tickets', ticket.recordId, { status: params.status });
        return { key, from: ticket.status, to: params.status };
      },
    },
  ],
  triggers: [
    {
      id: 'ticket_created',
      name: 'Ticket created',
      description: 'A ticket was created in a project.',
      samplePayload: { key: 'WEB-57', project: 'WEB', summary: 'Checkout times out for EU cards', type: 'Bug', reporter: 'priya@acme.test' },
    },
  ],
  inbound: genericInbound(['ticket_created']),
});
