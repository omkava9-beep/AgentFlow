import { defineIntegration, assertOk } from '../defineAction.js';
import { PermanentFailure } from '../../queue/errors.js';
import { snowflake } from '../ids.js';

const DISCORD_HOSTS = new Set(['discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com']);
const SANDBOX_CHANNEL = '1100000000000000001';

/** Webhook URLs only ever live on Discord's own hosts under /api/webhooks/. */
function webhookUrlOf(connection) {
  let url;
  try {
    url = new URL(connection?.credentials?.webhookUrl);
  } catch {
    throw new PermanentFailure('Discord connection has no valid webhook URL');
  }
  if (url.protocol !== 'https:' || !DISCORD_HOSTS.has(url.hostname) || !url.pathname.startsWith('/api/webhooks/')) {
    throw new PermanentFailure('Discord webhook URLs must look like https://discord.com/api/webhooks/…');
  }
  return url;
}

/** `?wait=true` makes Discord return the created message instead of a bare 204. */
async function execute({ connection, http, body }) {
  const url = webhookUrlOf(connection);
  url.searchParams.set('wait', 'true');
  const response = await http({ url: url.toString(), method: 'POST', body });
  assertOk(response, { method: 'POST', what: 'Discord webhook' });
  return { sent: true, id: String(response.body?.id ?? ''), channelId: String(response.body?.channel_id ?? '') };
}

export default defineIntegration({
  id: 'discord',
  name: 'Discord',
  icon: 'discord',
  category: 'communication',
  description: 'Send messages and embeds to a Discord channel through a webhook.',
  auth: {
    type: 'webhookUrl',
    fields: [
      { key: 'webhookUrl', label: 'Webhook URL', type: 'text', required: true, secret: true, placeholder: 'https://discord.com/api/webhooks/…' },
    ],
  },
  // Discord answers GET on a webhook URL with the webhook's details — a real
  // check that doesn't post anything.
  test: async ({ connection, http }) => {
    const response = await http({ url: webhookUrlOf(connection).toString(), method: 'GET' });
    if (!response.ok) return { ok: false, message: `Discord returned ${response.status} for this webhook` };
    return { ok: true, message: `Webhook "${response.body?.name || 'unnamed'}" is reachable` };
  },
  actions: [
    {
      id: 'send_message',
      name: 'Send message',
      description: 'Post a plain message. Supports {{input.field}}.',
      sideEffect: true,
      configSchema: [
        { key: 'content', label: 'Content', type: 'textarea', required: true, placeholder: 'Deploy finished: {{input.version}}' },
        { key: 'username', label: 'Display name', type: 'text', placeholder: 'AgentFlow' },
      ],
      outputSample: { sent: true, id: '1286543210987654321', channelId: SANDBOX_CHANNEL },
      sandbox: async ({ params, sandbox, logs }) => {
        const id = snowflake();
        await sandbox.insert('messages', { id, channelId: SANDBOX_CHANNEL, content: params.content, username: params.username || null });
        logs.push('[discord] sandbox message recorded (nothing was sent to Discord)');
        return { sent: true, id, channelId: SANDBOX_CHANNEL };
      },
      live: async ({ params, connection, http, logs }) => {
        const out = await execute({ connection, http, body: { content: params.content, ...(params.username && { username: params.username }) } });
        logs.push(`[discord] message ${out.id} posted`);
        return out;
      },
    },
    {
      id: 'send_embed',
      name: 'Send embed',
      description: 'Post a rich embed card.',
      sideEffect: true,
      configSchema: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'color', label: 'Colour (decimal)', type: 'number', default: 5793266 },
        { key: 'url', label: 'Link', type: 'text', placeholder: 'https://…' },
      ],
      outputSample: { sent: true, id: '1286543210987654322', channelId: SANDBOX_CHANNEL },
      sandbox: async ({ params, sandbox }) => {
        const id = snowflake();
        await sandbox.insert('messages', { id, channelId: SANDBOX_CHANNEL, embed: { title: params.title, description: params.description || '', color: params.color, url: params.url || null } });
        return { sent: true, id, channelId: SANDBOX_CHANNEL };
      },
      live: async ({ params, connection, http }) => execute({
        connection,
        http,
        body: { embeds: [{ title: params.title, description: params.description || undefined, color: Number(params.color) || undefined, url: params.url || undefined }] },
      }),
    },
  ],
});
