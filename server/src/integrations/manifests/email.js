import { defineIntegration } from '../defineAction.js';
import { sendMail } from '../../services/outbox.js';
import { genericInbound } from '../inboundUtil.js';

let counter = 0;
const messageId = () => `mock-${Date.now().toString(36)}-${++counter}`;

/**
 * Real email delivery is a phase-3 non-goal, so there is no live adapter: the
 * sandbox "sends" by writing an OutboxMessage (spec/23 §3, kind 'smtp') to the
 * recipient, where it can actually be read.
 */
export default defineIntegration({
  id: 'email',
  name: 'Email (SMTP)',
  icon: 'mail',
  category: 'communication',
  description: 'Send email. Messages land in the recipient\'s Outbox.',
  auth: {
    type: 'custom',
    fields: [
      { key: 'host', label: 'SMTP host', type: 'text', required: true, placeholder: 'smtp.example.com' },
      { key: 'port', label: 'Port', type: 'number', default: 587 },
      { key: 'username', label: 'Username', type: 'text' },
      { key: 'password', label: 'Password', type: 'text', secret: true },
    ],
  },
  actions: [
    {
      id: 'send',
      name: 'Send email',
      description: 'Send an email. Supports {{input.field}} placeholders.',
      sideEffect: true,
      configSchema: [
        { key: 'to', label: 'To', type: 'text', required: true, placeholder: 'someone@example.com' },
        { key: 'subject', label: 'Subject', type: 'text', default: '(no subject)' },
        { key: 'body', label: 'Body', type: 'textarea', placeholder: 'Supports {{input.field}}' },
      ],
      outputSample: { delivered: true, to: 'someone@example.com', subject: 'Hello', messageId: 'mock-1' },
      sandbox: async ({ params, workspaceId, runId, workflowId, logs }) => {
        const id = messageId();
        await sendMail({
          to: String(params.to).toLowerCase(),
          subject: params.subject,
          text: params.body || '',
          kind: 'smtp',
          workspaceId: workspaceId || null,
          meta: { runId: runId ? String(runId) : null, workflowId: workflowId ? String(workflowId) : null, messageId: id },
        });
        logs.push(`[email.send] delivered to ${params.to}'s Outbox (no real email is sent)`);
        return { delivered: true, to: params.to, subject: params.subject, body: params.body || '', messageId: id };
      },
    },
  ],
  triggers: [
    {
      id: 'email_received',
      name: 'Email received',
      description: 'An inbound email arrived.',
      samplePayload: { from: 'customer@example.com', to: 'support@acme.test', subject: 'Order #1042 is late', text: 'Hi, my order has not arrived yet.' },
    },
  ],
  // An inbound-mail relay posts `{ "trigger": "email_received", "data": { from, to, subject, text } }`.
  inbound: genericInbound(['email_received']),
});
