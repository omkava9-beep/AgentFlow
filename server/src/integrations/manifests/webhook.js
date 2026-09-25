import { defineIntegration, assertOk } from '../defineAction.js';
import { PermanentFailure } from '../../queue/errors.js';
import { hmacHex } from '../inboundUtil.js';

/**
 * Outbound Webhook (spec/27 §4): POSTs JSON to any URL, live by default like
 * the HTTP tool (auth 'none'), through safeRequest's SSRF guard. With a secret
 * on the connection, the exact bytes sent are signed so the receiver can verify
 * them: `X-AgentFlow-Signature: sha256=<hmac>`.
 */
export default defineIntegration({
  id: 'webhook',
  name: 'Outbound Webhook',
  icon: 'send',
  category: 'web',
  description: 'POST a JSON payload to any URL, optionally HMAC-signed.',
  auth: {
    type: 'none',
    fields: [{ key: 'secret', label: 'Signing secret (optional)', type: 'text', secret: true }],
  },
  actions: [
    {
      id: 'post',
      name: 'Send webhook',
      sideEffect: true,
      configSchema: [
        { key: 'url', label: 'URL', type: 'text', required: true, placeholder: 'https://example.com/hooks/agentflow' },
        { key: 'payload', label: 'Payload (JSON, blank = node input)', type: 'json', placeholder: '{ "event": "order.refunded", "id": "{{input.id}}" }' },
      ],
      outputSample: { status: 200, ok: true, url: 'https://example.com/hooks/agentflow', durationMs: 180 },
      sandbox: async ({ params, input, sandbox, logs }) => {
        await sandbox.insert('deliveries', { url: params.url, payload: params.payload ?? input ?? {} });
        logs.push(`[webhook] sandbox delivery to ${params.url} recorded (no request was sent)`);
        return { status: 200, ok: true, url: params.url, durationMs: 0, simulated: true };
      },
      live: async ({ params, input, connection, http, logs }) => {
        const payload = params.payload ?? input ?? {};
        if (typeof payload !== 'object') throw new PermanentFailure('Webhook payload must be a JSON object or array');
        // Serialized once so the signature covers exactly the bytes on the wire.
        const body = JSON.stringify(payload);
        const headers = { 'Content-Type': 'application/json' };
        const secret = connection?.credentials?.secret;
        if (secret) headers['X-AgentFlow-Signature'] = `sha256=${hmacHex(secret, body)}`;
        const response = await http({ url: params.url, method: 'POST', headers, body });
        logs.push(`[webhook] POST ${response.url} -> ${response.status} in ${response.durationMs}ms${secret ? ' (signed)' : ''}`);
        assertOk(response, { method: 'POST', what: 'Webhook' });
        return { status: response.status, ok: response.ok, url: response.url, durationMs: response.durationMs };
      },
    },
  ],
});
