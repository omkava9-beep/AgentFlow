import { defineIntegration, assertOk } from '../defineAction.js';
import { PermanentFailure } from '../../queue/errors.js';
import { hmacHex, safeEqualHex } from '../inboundUtil.js';

const tsNow = () => `${Math.floor(Date.now() / 1000)}.${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;

/** Incoming webhooks only live on hooks.slack.com; anything else is a config error. */
function webhookUrlOf(connection) {
  const raw = connection?.credentials?.webhookUrl;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new PermanentFailure('Slack connection has no valid incoming webhook URL');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'hooks.slack.com') {
    throw new PermanentFailure('Slack incoming webhook URLs must be on https://hooks.slack.com');
  }
  return url.toString();
}

export default defineIntegration({
  id: 'slack',
  name: 'Slack',
  icon: 'slack',
  category: 'communication',
  description: 'Post messages to Slack channels.',
  auth: {
    type: 'webhookUrl',
    fields: [
      { key: 'webhookUrl', label: 'Incoming webhook URL', type: 'text', required: true, secret: true, placeholder: 'https://hooks.slack.com/services/…' },
      { key: 'signingSecret', label: 'Signing secret (for inbound events, optional)', type: 'text', secret: true },
    ],
  },
  // Format check only: posting a message just to test would be a side effect.
  test: async ({ connection }) => {
    webhookUrlOf(connection);
    return { ok: true, detail: 'Webhook URL format looks right' };
  },
  actions: [
    {
      id: 'post_message',
      name: 'Post message',
      description: 'Post a message to a channel.',
      sideEffect: true,
      configSchema: [
        { key: 'channel', label: 'Channel', type: 'text', required: true, placeholder: '#general' },
        { key: 'text', label: 'Text', type: 'textarea', placeholder: 'Supports {{input.field}}' },
        { key: 'blocks', label: 'Blocks (JSON)', type: 'json', placeholder: '[{ "type": "section", … }]' },
      ],
      outputSample: { posted: true, channel: '#alerts', ts: '1727000000.000100' },
      sandbox: async ({ params, sandbox, logs }) => {
        const ts = tsNow();
        await sandbox.insert('messages', { channel: params.channel, text: params.text || '', ts });
        logs.push(`[slack] sandbox post to ${params.channel} (nothing was sent to Slack)`);
        return { posted: true, channel: params.channel, text: params.text || '', ts };
      },
      live: async ({ params, connection, http, logs }) => {
        const url = webhookUrlOf(connection);
        const body = { text: params.text || '' };
        if (params.blocks) body.blocks = params.blocks;
        const response = await http({ url, method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
        assertOk(response, { method: 'POST', what: 'Slack webhook' });
        logs.push(`[slack] posted to ${params.channel} via incoming webhook`);
        // Incoming webhooks answer a bare "ok" and no message ts.
        return { posted: true, channel: params.channel, text: params.text || '', ts: tsNow() };
      },
    },
    {
      id: 'post_to_thread',
      name: 'Post to thread',
      description: 'Reply in a message thread (sandbox only).',
      sideEffect: true,
      configSchema: [
        { key: 'channel', label: 'Channel', type: 'text', required: true, placeholder: '#general' },
        { key: 'threadTs', label: 'Thread ts', type: 'text', required: true },
        { key: 'text', label: 'Text', type: 'textarea' },
      ],
      outputSample: { posted: true, channel: '#alerts', threadTs: '1727000000.000100', ts: '1727000001.000200' },
      sandbox: async ({ params, sandbox }) => {
        const ts = tsNow();
        await sandbox.insert('messages', { channel: params.channel, threadTs: params.threadTs, text: params.text || '', ts });
        return { posted: true, channel: params.channel, threadTs: params.threadTs, ts };
      },
    },
  ],
  triggers: [
    {
      id: 'message_received',
      name: 'Message received',
      description: 'A message was posted in a channel the app can see.',
      samplePayload: { channel: '#support', user: 'U024BE7LH', text: 'Is the refund for order 1042 done?', ts: '1727000000.000100' },
    },
  ],
  inbound: {
    // Slack signs `v0:<timestamp>:<raw body>` with the app's signing secret and
    // rejects anything older than five minutes; so do we.
    verify: ({ headers, rawBody, connection }) => {
      const secret = connection?.credentials?.signingSecret;
      if (!secret) return true;
      const ts = Number(headers['x-slack-request-timestamp']);
      if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
      const given = String(headers['x-slack-signature'] || '').replace(/^v0=/, '');
      return safeEqualHex(given, hmacHex(secret, `v0:${ts}:${Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody ?? '')}`));
    },
    parse: ({ body }) => {
      // The Events API proves the URL by echoing a challenge once, at setup.
      if (body?.type === 'url_verification') return { respond: { status: 200, body: { challenge: body.challenge } } };
      const event = body?.type === 'event_callback' ? body.event : null;
      // Bot messages (including our own posts) are ignored, or a workflow that
      // posts to a channel it listens on would trigger itself forever.
      if (!event || event.type !== 'message' || event.bot_id || event.subtype) return null;
      return { triggerId: 'message_received', data: { channel: event.channel, user: event.user, text: event.text || '', ts: event.ts }, deliveryId: body.event_id || undefined };
    },
  },
});
