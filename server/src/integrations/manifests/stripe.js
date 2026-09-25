import { defineIntegration } from '../defineAction.js';
import { PermanentFailure } from '../../queue/errors.js';
import { stripeId } from '../ids.js';
import { hmacHex, safeEqualHex } from '../inboundUtil.js';

const SIGNATURE_TOLERANCE_S = 300;

/** Two customers and three payments, so refunds and invoices have something to refer to. */
const FIXTURE_CUSTOMERS = [
  { email: 'billing@northwind.test', name: 'Northwind Traders' },
  { email: 'ap@contoso.test', name: 'Contoso Ltd' },
];
const FIXTURE_PAYMENTS = [
  { amount: 4900, currency: 'usd', status: 'succeeded', description: 'Pro plan — September' },
  { amount: 12900, currency: 'usd', status: 'succeeded', description: 'Team plan — September' },
  { amount: 2500, currency: 'eur', status: 'requires_payment_method', description: 'Add-on seats' },
];

async function ensureFixtures(sandbox) {
  const customers = FIXTURE_CUSTOMERS.map((c) => ({ ...c, id: stripeId('cus'), created: Math.floor(Date.now() / 1000) - 86_400 * 30 }));
  await sandbox.seedOnce('customers', 'customers', customers);
  await sandbox.seedOnce('payments', 'payments', async () => {
    const [first, second] = await sandbox.find('customers', {}, { limit: 2, sort: { createdAt: 1 } });
    return FIXTURE_PAYMENTS.map((p, i) => ({ ...p, id: stripeId('pi'), customer: (i % 2 ? second : first)?.id || null, refunded: 0 }));
  });
}

function amountOf(value, what = 'Amount') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new PermanentFailure(`${what} must be a positive whole number in the currency's minor unit (e.g. 4900 = $49.00)`);
  return n;
}

/** Stripe's `t=…,v1=…` scheme: HMAC-SHA256 over `${t}.${rawBody}`, 5-minute tolerance. */
function verifyStripeSignature({ header, rawBody, secret, now = Date.now() }) {
  const parts = String(header || '').split(',').map((p) => p.trim().split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(t) || !signatures.length) return false;
  if (Math.abs(now / 1000 - t) > SIGNATURE_TOLERANCE_S) return false;
  const expected = hmacHex(secret, Buffer.concat([Buffer.from(`${t}.`), Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''))]));
  return signatures.some((sig) => safeEqualHex(sig, expected));
}

export default defineIntegration({
  id: 'stripe',
  name: 'Stripe',
  icon: 'card',
  category: 'commerce',
  description: 'Customers, invoices and refunds (sandbox); real signed payment webhooks.',
  auth: {
    type: 'bearer',
    fields: [
      { key: 'secretKey', label: 'Secret key', type: 'text', required: true, secret: true, placeholder: 'sk_test_…' },
      { key: 'webhookSecret', label: 'Webhook signing secret (optional)', type: 'text', secret: true, placeholder: 'whsec_…' },
    ],
  },
  actions: [
    {
      id: 'create_customer',
      name: 'Create customer',
      sideEffect: true,
      configSchema: [
        { key: 'email', label: 'Email', type: 'text', required: true },
        { key: 'name', label: 'Name', type: 'text' },
      ],
      outputSample: { id: 'cus_Q3m2Xk9LpTz4Vw', email: 'jane@example.com', name: 'Jane Doe', created: 1727000000 },
      sandbox: async ({ params, sandbox }) => {
        await ensureFixtures(sandbox);
        const customer = { id: stripeId('cus'), email: params.email, name: params.name || null, created: Math.floor(Date.now() / 1000) };
        await sandbox.insert('customers', customer);
        return customer;
      },
    },
    {
      id: 'create_invoice',
      name: 'Create invoice',
      sideEffect: true,
      configSchema: [
        { key: 'customer', label: 'Customer id', type: 'text', required: true, placeholder: '{{input.id}}' },
        { key: 'amount', label: 'Amount (minor units)', type: 'number', required: true, placeholder: '4900' },
        { key: 'currency', label: 'Currency', type: 'text', default: 'usd' },
      ],
      outputSample: { id: 'in_1Pz8Yq2eZvKYlo2C', customer: 'cus_Q3m2Xk9LpTz4Vw', amount: 4900, currency: 'usd', status: 'open', hostedInvoiceUrl: 'https://invoice.stripe.com/i/acct_sandbox/in_1Pz8Yq2eZvKYlo2C' },
      sandbox: async ({ params, sandbox }) => {
        await ensureFixtures(sandbox);
        const customer = await sandbox.findOne('customers', { id: String(params.customer || '').trim() });
        if (!customer) throw new PermanentFailure(`No such customer: '${params.customer}'`);
        const id = stripeId('in');
        const invoice = { id, customer: customer.id, amount: amountOf(params.amount), currency: String(params.currency || 'usd').toLowerCase(), status: 'open', hostedInvoiceUrl: `https://invoice.stripe.com/i/acct_sandbox/${id}` };
        await sandbox.insert('invoices', invoice);
        return invoice;
      },
    },
    {
      id: 'refund',
      name: 'Refund payment',
      sideEffect: true,
      configSchema: [
        { key: 'payment', label: 'Payment intent id', type: 'text', required: true, placeholder: '{{input.paymentId}}' },
        { key: 'amount', label: 'Amount (minor units, blank = full)', type: 'number' },
      ],
      outputSample: { id: 're_3Pz8Yq2eZvKYlo2C', payment: 'pi_3Pz8Yq2eZvKYlo2C', amount: 4900, currency: 'usd', status: 'succeeded' },
      sandbox: async ({ params, sandbox }) => {
        await ensureFixtures(sandbox);
        const payment = await sandbox.findOne('payments', { id: String(params.payment || '').trim() });
        if (!payment) throw new PermanentFailure(`No such payment_intent: '${params.payment}'`);
        if (payment.status !== 'succeeded') throw new PermanentFailure(`PaymentIntent ${payment.id} has status ${payment.status} and can't be refunded`);
        const remaining = payment.amount - (payment.refunded || 0);
        const amount = params.amount === undefined || params.amount === null || params.amount === '' ? remaining : amountOf(params.amount);
        if (amount > remaining) throw new PermanentFailure(`Refund amount (${amount}) is greater than the unrefunded amount (${remaining})`);
        const refund = { id: stripeId('re'), payment: payment.id, amount, currency: payment.currency, status: 'succeeded' };
        await sandbox.insert('refunds', refund);
        await sandbox.update('payments', payment.recordId, { refunded: (payment.refunded || 0) + amount });
        return refund;
      },
    },
  ],
  triggers: [
    {
      id: 'payment_succeeded',
      name: 'Payment succeeded',
      description: 'A PaymentIntent succeeded.',
      samplePayload: { paymentId: 'pi_3Pz8Yq2eZvKYlo2C', amount: 4900, currency: 'usd', customer: 'cus_Q3m2Xk9LpTz4Vw', status: 'succeeded', failureMessage: null },
    },
    {
      id: 'payment_failed',
      name: 'Payment failed',
      description: 'A PaymentIntent failed.',
      samplePayload: { paymentId: 'pi_3Pz9Aa1eZvKYlo2D', amount: 12900, currency: 'usd', customer: 'cus_Q3m2Xk9LpTz4Vw', status: 'requires_payment_method', failureMessage: 'Your card was declined.' },
    },
  ],
  inbound: {
    verify: ({ headers, rawBody, connection }) => {
      const secret = connection?.credentials?.webhookSecret;
      if (!secret) return true;
      return verifyStripeSignature({ header: headers['stripe-signature'], rawBody, secret });
    },
    parse: ({ body }) => {
      const map = { 'payment_intent.succeeded': 'payment_succeeded', 'payment_intent.payment_failed': 'payment_failed' };
      const triggerId = map[body?.type];
      if (!triggerId) return null;
      const pi = body.data?.object || {};
      return {
        triggerId,
        data: {
          paymentId: pi.id || null,
          amount: pi.amount ?? null,
          currency: pi.currency || null,
          customer: pi.customer || null,
          status: pi.status || null,
          failureMessage: pi.last_payment_error?.message || null,
        },
        deliveryId: body.id || undefined,
      };
    },
  },
});

export { verifyStripeSignature };
