import { defineIntegration } from '../defineAction.js';

/** Sandbox only (spec/27 §4): posts are recorded, never sent. */
export default defineIntegration({
  id: 'teams',
  name: 'Microsoft Teams',
  icon: 'teams',
  category: 'communication',
  description: 'Post cards to a Teams channel (sandbox).',
  auth: {
    type: 'webhookUrl',
    fields: [
      { key: 'webhookUrl', label: 'Incoming webhook URL', type: 'text', required: true, secret: true, placeholder: 'https://example.webhook.office.com/…' },
    ],
  },
  actions: [
    {
      id: 'post_message',
      name: 'Post message',
      description: 'Post a message card to the channel.',
      sideEffect: true,
      configSchema: [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'text', label: 'Text', type: 'textarea', required: true },
      ],
      outputSample: { posted: true, title: 'Nightly build', text: 'All 212 tests passed.' },
      sandbox: async ({ params, sandbox, logs }) => {
        await sandbox.insert('messages', { title: params.title || null, text: params.text });
        logs.push('[teams] sandbox card recorded (nothing was sent to Teams)');
        return { posted: true, title: params.title || null, text: params.text };
      },
    },
  ],
});
