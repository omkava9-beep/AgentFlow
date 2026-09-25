import { defineIntegration } from '../defineAction.js';
import { PermanentFailure } from '../../queue/errors.js';
import { genericInbound } from '../inboundUtil.js';

const STAGES = ['appointmentscheduled', 'qualifiedtobuy', 'presentationscheduled', 'decisionmakerboughtin', 'contractsent', 'closedwon', 'closedlost'];
const FIXTURE_DEALS = [
  { deal: '9001', name: 'Northwind — annual renewal', stage: 'contractsent', amount: 18000 },
  { deal: '9002', name: 'Globex — team expansion', stage: 'qualifiedtobuy', amount: 7400 },
  { deal: '9003', name: 'Initech — pilot', stage: 'appointmentscheduled', amount: 2500 },
];

const ensureDeals = (sandbox) => sandbox.seedOnce('deals', 'deals', FIXTURE_DEALS);

export default defineIntegration({
  id: 'hubspot',
  name: 'HubSpot',
  icon: 'crm',
  category: 'commerce',
  description: 'Contacts and deal stages (sandbox).',
  auth: {
    type: 'bearer',
    fields: [{ key: 'token', label: 'Private app token', type: 'text', required: true, secret: true, placeholder: 'pat-na1-…' }],
  },
  actions: [
    {
      id: 'create_contact',
      name: 'Create contact',
      sideEffect: true,
      configSchema: [
        { key: 'email', label: 'Email', type: 'text', required: true },
        { key: 'firstName', label: 'First name', type: 'text' },
        { key: 'lastName', label: 'Last name', type: 'text' },
      ],
      outputSample: { id: '51', email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe', createdAt: '2026-09-25T10:00:00.000Z' },
      sandbox: async ({ params, sandbox }) => {
        const email = String(params.email).trim().toLowerCase();
        if (await sandbox.findOne('contacts', { email })) {
          throw new PermanentFailure(`Contact already exists. Existing ID: ${email}`);
        }
        const id = String(await sandbox.nextNumber('contacts', { after: 50 }));
        const contact = { id, email, firstName: params.firstName || null, lastName: params.lastName || null, createdAt: new Date().toISOString() };
        await sandbox.insert('contacts', contact);
        return contact;
      },
    },
    {
      id: 'update_deal_stage',
      name: 'Update deal stage',
      sideEffect: true,
      configSchema: [
        { key: 'deal', label: 'Deal id', type: 'text', required: true, placeholder: '9001' },
        { key: 'stage', label: 'Stage', type: 'select', required: true, default: 'closedwon', options: STAGES.map((s) => ({ value: s, label: s })) },
      ],
      outputSample: { deal: '9001', name: 'Northwind — annual renewal', from: 'contractsent', to: 'closedwon' },
      sandbox: async ({ params, sandbox }) => {
        await ensureDeals(sandbox);
        if (!STAGES.includes(params.stage)) throw new PermanentFailure(`Unknown deal stage "${params.stage}"`);
        const deal = await sandbox.findOne('deals', { deal: String(params.deal).trim() });
        if (!deal) throw new PermanentFailure(`Deal ${params.deal} not found`);
        await sandbox.update('deals', deal.recordId, { stage: params.stage });
        return { deal: deal.deal, name: deal.name, from: deal.stage, to: params.stage };
      },
    },
  ],
  triggers: [
    {
      id: 'contact_created',
      name: 'Contact created',
      description: 'A new contact was added.',
      samplePayload: { id: '77', email: 'lead@globex.test', firstName: 'Hank', lastName: 'Scorpio' },
    },
  ],
  inbound: genericInbound(['contact_created']),
});
