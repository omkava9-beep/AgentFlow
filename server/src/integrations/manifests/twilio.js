import { defineIntegration } from '../defineAction.js';
import { twilioSid } from '../ids.js';

export default defineIntegration({
  id: 'twilio',
  name: 'Twilio SMS',
  icon: 'sms',
  category: 'communication',
  description: 'Send text messages (sandbox) and receive inbound SMS.',
  auth: {
    type: 'basic',
    fields: [
      { key: 'accountSid', label: 'Account SID', type: 'text', required: true, placeholder: 'AC…' },
      { key: 'authToken', label: 'Auth token', type: 'text', required: true, secret: true },
      { key: 'fromNumber', label: 'From number', type: 'text', placeholder: '+15005550006' },
    ],
  },
  actions: [
    {
      id: 'send_sms',
      name: 'Send SMS',
      description: 'Queue a text message.',
      sideEffect: true,
      configSchema: [
        { key: 'to', label: 'To', type: 'text', required: true, placeholder: '+14155550123' },
        { key: 'body', label: 'Message', type: 'textarea', required: true, placeholder: 'Your order {{input.orderId}} has shipped' },
      ],
      outputSample: { sid: 'SM8d3f0c1e2b4a59687c6d5e4f3a2b1c0d', status: 'queued', to: '+14155550123' },
      sandbox: async ({ params, connection, sandbox }) => {
        const sid = twilioSid();
        await sandbox.insert('messages', { sid, to: params.to, from: connection?.config?.fromNumber || '+15005550006', body: params.body, status: 'queued' });
        return { sid, status: 'queued', to: params.to };
      },
    },
  ],
  triggers: [
    {
      id: 'sms_received',
      name: 'SMS received',
      description: 'Someone texted your Twilio number.',
      samplePayload: { from: '+14155550123', to: '+15005550006', body: 'STOP', messageSid: 'SM1a2b3c4d5e6f708192a3b4c5d6e7f809' },
    },
  ],
  // Twilio posts form-encoded fields. Its X-Twilio-Signature is computed over
  // the full public URL, which a local deployment can't know reliably, so the
  // inbound token in the URL is the credential (spec/27 §5).
  inbound: {
    verify: () => true,
    parse: ({ body }) => {
      if (!body?.From && !body?.Body) return null;
      return {
        triggerId: 'sms_received',
        data: { from: body.From || null, to: body.To || null, body: body.Body || '', messageSid: body.MessageSid || null },
        deliveryId: body.MessageSid || undefined,
      };
    },
  },
});
