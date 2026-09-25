/**
 * The built-in template catalogue (spec/15, extended in phase 3).
 *
 * Every template here solves a problem a real team has - a failed payment, a
 * support inbox, an incident page - using the real integration actions and the
 * advanced nodes. Each one ships with a `sampleInput` shaped like the trigger's
 * real payload, and `npm run check:template-catalog` proves every template
 * validates with zero errors and runs to success in sandbox mode.
 *
 * Data flow reminders that shape these graphs:
 *  - A tool's params see `{{input.x}}` - the output of the node right before it.
 *  - Transform, Approval, Loop and Sub-workflow templates also see `{{run.input.x}}`,
 *    the payload that started the run. That's why a "Compose …" transform sits in
 *    front of most outbound messages: it gathers fields from the trigger payload
 *    and from the step before.
 *  - An integration event's payload arrives as `run.input.data` (spec/26 §7).
 *  - A Loop body receives `{ item, index, total, parent }`.
 *
 * Loop/sub-workflow bodies ship as their own templates tagged 'companion'; the
 * parent references them as `companion:<key>`, and "Use template" creates and
 * publishes the companion first, then wires the real workflow id in.
 */

const COL = 260;
const ROW = 150;

export const TEMPLATE_CATEGORIES = [
  'Revenue & billing',
  'Customer support',
  'Sales & marketing',
  'Engineering & DevOps',
  'Operations',
  'People & HR',
  'AI & knowledge',
];

export const COMPANION_PREFIX = 'companion:';

// ------------------------------------------------------------------ builders

function graph() {
  const nodes = [];
  const edges = [];
  const add = (id, type, col, row, config) => {
    nodes.push({ id, type, position: { x: Math.round(col * COL), y: Math.round(row * ROW) }, data: { config } });
  };
  const api = {
    start: (id, col, row, label) => { add(id, 'start', col, row, { label }); return api; },
    end: (id, col, row, label = 'Done') => { add(id, 'end', col, row, { label }); return api; },
    tool: (id, col, row, label, integration, action, params = {}) => {
      add(id, 'tool', col, row, { label, integration, action, connectionId: null, params, mockOverrides: {} });
      return api;
    },
    agent: (id, col, row, label, systemPrompt, extra = {}) => {
      add(id, 'agent', col, row, { label, systemPrompt, isHandoff: false, candidates: [], tools: [], allowSideEffects: false, ...extra });
      return api;
    },
    transform: (id, col, row, label, mappings, mode = 'replace') => {
      add(id, 'transform', col, row, { label, mode, mappings: Object.entries(mappings).map(([key, value]) => ({ key, value })) });
      return api;
    },
    condition: (id, col, row, label, expression) => { add(id, 'condition', col, row, { label, expression }); return api; },
    approval: (id, col, row, label, { title, description = '', roles = ['owner', 'admin'], minApprovals = 1, timeout = null }) => {
      add(id, 'approval', col, row, {
        label, title, description, assignees: { userIds: [], roles }, minApprovals, ...(timeout && { timeout }),
      });
      return api;
    },
    loop: (id, col, row, label, { itemsPath, companion, concurrency = 3, continueOnError = true }) => {
      add(id, 'loop', col, row, { label, itemsPath, workflowId: `${COMPANION_PREFIX}${companion}`, concurrency, continueOnError });
      return api;
    },
    code: (id, col, row, label, source) => { add(id, 'code', col, row, { label, source }); return api; },
    delay: (id, col, row, label, durationMs) => { add(id, 'delay', col, row, { label, mode: 'duration', durationMs }); return api; },
    merge: (id, col, row, label, mode = 'all') => { add(id, 'merge', col, row, { label, mode, output: 'keyed' }); return api; },
    /** `a -> b`, or with options: { handle, label }. */
    edge: (source, target, { handle, label } = {}) => {
      edges.push({
        id: `e-${source}-${target}${handle ? `-${handle}` : ''}`,
        source,
        target,
        ...(handle && { sourceHandle: handle }),
        ...(label && { label }),
      });
      return api;
    },
    chain: (...ids) => { for (let i = 0; i < ids.length - 1; i += 1) api.edge(ids[i], ids[i + 1]); return api; },
    yes: (source, target) => api.edge(source, target, { handle: 'true', label: 'yes' }),
    no: (source, target) => api.edge(source, target, { handle: 'false', label: 'no' }),
    approved: (source, target) => api.edge(source, target, { handle: 'approved', label: 'approved' }),
    rejected: (source, target) => api.edge(source, target, { handle: 'rejected', label: 'rejected' }),
    onError: (source, target) => api.edge(source, target, { handle: 'error', label: 'on error' }),
    done: () => ({ nodes, edges }),
  };
  return api;
}

const HOUR = 60 * 60 * 1000;
const envelope = (event, data) => ({
  event,
  integration: event.split('.')[0],
  test: true,
  receivedAt: '2026-09-25T09:00:00.000Z',
  data,
});

// ------------------------------------------------------------------ templates

const failedPaymentRecovery = {
  key: 'failed-payment-recovery',
  name: 'Failed payment recovery',
  category: 'Revenue & billing',
  icon: 'CreditCard',
  summary: 'Win back failed card payments with a reviewed, personal recovery email.',
  useCase: 'Involuntary churn from declined cards quietly costs subscription businesses a few percent of revenue. '
    + 'When Stripe reports a failed payment, small amounts get an automatic reminder, while larger ones go to a '
    + 'person for approval before an AI-drafted, apologetic recovery email goes out and #revenue hears about it.',
  tags: ['stripe', 'dunning', 'churn', 'approval', 'ai'],
  difficulty: 'intermediate',
  estimatedSetupMinutes: 15,
  requiredIntegrations: ['stripe', 'email', 'slack', 'ai'],
  trigger: { type: 'event', eventName: 'stripe.payment_failed' },
  sampleInput: envelope('stripe.payment_failed', {
    paymentId: 'pi_3Pz9Aa1eZvKYlo2D',
    amount: 12900,
    currency: 'usd',
    customer: 'cus_Q3m2Xk9LpTz4Vw',
    customerName: 'Jane Doe',
    customerEmail: 'jane@northwind.test',
    status: 'requires_payment_method',
    failureMessage: 'Your card was declined.',
  }),
  ...graph()
    .start('s', 0, 0, 'When a payment fails')
    .transform('prep', 1, 0, 'Normalise payment', {
      paymentId: '{{run.input.data.paymentId}}',
      amount: '{{run.input.data.amount}}',
      currency: '{{run.input.data.currency}}',
      customerName: '{{run.input.data.customerName}}',
      customerEmail: '{{run.input.data.customerEmail}}',
      reason: '{{run.input.data.failureMessage}}',
    })
    .condition('big', 2, 0, 'Over $100?', 'output.amount >= 10000')
    .approval('ap', 3, -1, 'Approve personal outreach', {
      title: 'Reach out about failed payment {{run.input.data.paymentId}}?',
      description: '{{run.input.data.customerName}} · {{run.input.data.amount}} {{run.input.data.currency}} (cents) · {{run.input.data.failureMessage}}',
      // Nobody answered in 4 hours? Send it anyway - a slow reply costs more than a nudge.
      timeout: { afterMs: 4 * HOUR, outcome: 'approved' },
    })
    .tool('draft', 4, -1.5, 'Draft a recovery email', 'ai', 'draft_reply', { tone: 'apologetic' })
    .transform('compose', 5, -1.5, 'Compose the email', {
      to: '{{run.input.data.customerEmail}}',
      subject: "Action needed: your payment didn't go through",
      body: '{{input.reply}}\n\nUpdate your card here: https://billing.example.com/update',
      slack: 'Recovery email sent to {{run.input.data.customerEmail}} for {{run.input.data.amount}} {{run.input.data.currency}} (cents).',
    })
    .tool('mail', 6, -2, 'Email the customer', 'email', 'send', { to: '{{input.to}}', subject: '{{input.subject}}', body: '{{input.body}}' })
    .tool('tell', 6, -1, 'Tell #revenue', 'slack', 'post_message', { channel: '#revenue', text: '{{input.slack}}' })
    .tool('skip', 4, -0.5, 'Log skipped outreach', 'slack', 'post_message', {
      channel: '#revenue',
      text: 'A reviewer chose not to contact the customer about a failed payment.',
    })
    .transform('small', 3, 1, 'Compose a reminder', {
      to: '{{input.customerEmail}}',
      subject: "Your payment didn't go through",
      body: "Hi {{input.customerName}}, we couldn't process your payment of {{input.amount}} {{input.currency}} (cents): {{input.reason}} "
        + 'Please update your card at https://billing.example.com/update.',
    })
    .tool('remind', 4, 1, 'Send automatic reminder', 'email', 'send', { to: '{{input.to}}', subject: '{{input.subject}}', body: '{{input.body}}' })
    .end('e', 7, 0)
    .chain('s', 'prep', 'big')
    .yes('big', 'ap')
    .no('big', 'small')
    .approved('ap', 'draft')
    .rejected('ap', 'skip')
    .chain('draft', 'compose')
    .edge('compose', 'mail')
    .edge('compose', 'tell')
    .chain('small', 'remind')
    .edge('mail', 'e').edge('tell', 'e').edge('skip', 'e').edge('remind', 'e')
    .done(),
};

const refundApproval = {
  key: 'refund-request-approval',
  name: 'Refund request approval',
  category: 'Revenue & billing',
  icon: 'Undo2',
  summary: 'Check refund requests against policy, get sign-off, refund in Stripe and tell the customer.',
  useCase: 'Refund requests arrive from a help-centre form and end up in someone\'s inbox for days. '
    + 'This checks each request against your policy (30 days, up to $200), routes in-policy ones to an approver, '
    + 'issues the Stripe refund, and emails the customer either way. A refund Stripe rejects is flagged in #payments instead of silently failing.',
  tags: ['stripe', 'refunds', 'approval', 'policy', 'error branch'],
  difficulty: 'intermediate',
  estimatedSetupMinutes: 15,
  requiredIntegrations: ['database', 'stripe', 'email', 'slack'],
  trigger: { type: 'webhook' },
  sampleInput: {
    orderId: '1042',
    paymentId: 'pi_3Pz8Yq2eZvKYlo2C',
    amount: 4900,
    currency: 'usd',
    customerName: 'Sam Lee',
    customerEmail: 'sam@contoso.test',
    reason: 'The item arrived damaged.',
    daysSincePurchase: 12,
  },
  ...graph()
    .start('s', 0, 0, 'Refund requested')
    .tool('order', 1, 0, 'Look up the order', 'database', 'find', {
      collection: 'orders',
      filter: '{"orderId":"{{input.orderId}}"}',
      limit: 1,
    })
    .transform('policy', 2, 0, 'Apply refund policy', {
      orderId: '{{run.input.orderId}}',
      paymentId: '{{run.input.paymentId}}',
      amount: '{{run.input.amount}}',
      currency: '{{run.input.currency}}',
      days: '{{run.input.daysSincePurchase}}',
      ordersFound: '{{input.count}}',
    })
    .condition('within', 3, 0, 'Within policy?', 'output.days <= 30 && output.amount <= 20000')
    .approval('ap', 4, -1, 'Approve refund', {
      title: 'Refund order {{run.input.orderId}}?',
      description: '{{run.input.customerName}} asked for {{run.input.amount}} {{run.input.currency}} (cents) back: {{run.input.reason}}',
      timeout: { afterMs: 24 * HOUR, outcome: 'rejected' },
    })
    .transform('prep', 5, -1.5, 'Prepare the refund', { payment: '{{run.input.paymentId}}', amount: '{{run.input.amount}}' })
    .tool('refund', 6, -1.5, 'Issue the refund', 'stripe', 'refund', { payment: '{{input.payment}}', amount: '{{input.amount}}' })
    .transform('confirm', 7, -1.5, 'Compose confirmation', {
      to: '{{run.input.customerEmail}}',
      subject: 'Your refund is on its way',
      body: "Hi {{run.input.customerName}}, we've refunded {{input.amount}} {{input.currency}} (cents) for order {{run.input.orderId}}. "
        + 'It usually reaches your card in 5–10 business days.',
    })
    .tool('mailOk', 8, -1.5, 'Email the customer', 'email', 'send', { to: '{{input.to}}', subject: '{{input.subject}}', body: '{{input.body}}' })
    .tool('flag', 7, -2.5, 'Flag failed refund', 'slack', 'post_message', {
      channel: '#payments',
      text: 'A refund could not be issued automatically - please handle it in the Stripe dashboard.',
    })
    .transform('decline', 5, -0.5, 'Compose decline', {
      to: '{{run.input.customerEmail}}',
      subject: 'About your refund request',
      body: "Hi {{run.input.customerName}}, we reviewed your request for order {{run.input.orderId}} and can't refund it this time. "
        + 'Reply to this email if you have any questions.',
    })
    .tool('mailNo', 6, -0.5, 'Send the decision', 'email', 'send', { to: '{{input.to}}', subject: '{{input.subject}}', body: '{{input.body}}' })
    .tool('escalate', 4, 1, 'Escalate to a support lead', 'slack', 'post_message', {
      channel: '#support-leads',
      text: 'Out-of-policy refund request for order {{input.orderId}}: {{input.amount}} (cents), {{input.days}} days after purchase.',
    })
    .end('e', 9, 0)
    .chain('s', 'order', 'policy', 'within')
    .yes('within', 'ap')
    .no('within', 'escalate')
    .approved('ap', 'prep')
    .rejected('ap', 'decline')
    .chain('prep', 'refund', 'confirm', 'mailOk')
    .onError('refund', 'flag')
    .chain('decline', 'mailNo')
    .edge('mailOk', 'e').edge('flag', 'e').edge('mailNo', 'e').edge('escalate', 'e')
    .done(),
};

const invoiceIntake = {
  key: 'invoice-intake',
  name: 'Supplier invoice intake',
  category: 'Revenue & billing',
  icon: 'FileText',
  summary: 'Turn invoice emails into approved payables records - no retyping.',
  useCase: 'Accounts-payable teams retype supplier invoices from email into a ledger. '
    + 'This extracts the vendor, number, amount and due date from each invoice email, sends anything over $1,000 '
    + 'for finance approval, records it in the Airtable payables table, and keeps #finance in the loop.',
  tags: ['accounts payable', 'ai extraction', 'airtable', 'approval'],
  difficulty: 'advanced',
  estimatedSetupMinutes: 20,
  requiredIntegrations: ['email', 'ai', 'airtable', 'slack'],
  trigger: { type: 'event', eventName: 'email.email_received' },
  sampleInput: envelope('email.email_received', {
    from: 'billing@fabrikam.test',
    to: 'ap@acme.test',
    subject: 'Invoice INV-2291 - September services',
    text: 'Hi, attached is invoice INV-2291 for September. Amount due: $2,200.00 by 15 Oct 2026.',
    attachments: { invoice: { vendor: 'Fabrikam Inc', invoiceNumber: 'INV-2291', amount: 2200, dueDate: '2026-10-15' } },
  }),
  ...graph()
    .start('s', 0, 0, 'Invoice email received')
    .tool('extract', 1, 0, 'Extract invoice fields', 'ai', 'extract', { fields: 'vendor, invoiceNumber, amount, dueDate' })
    .transform('norm', 2, 0, 'Normalise the invoice', {
      vendor: '{{input.vendor}}',
      invoiceNumber: '{{input.invoiceNumber}}',
      amount: '{{input.amount}}',
      dueDate: '{{input.dueDate}}',
      sender: '{{run.input.data.from}}',
    })
    .condition('big', 3, 0, 'Over $1,000?', 'Number(output.amount) > 1000')
    .approval('ap', 4, -1, 'Finance approval', {
      title: 'Approve invoice {{input.invoiceNumber}} from {{input.vendor}}?',
      description: 'Amount {{input.amount}} · due {{input.dueDate}} · sent by {{input.sender}}',
    })
    .transform('recordA', 5, -1.5, 'Prepare the payable', {
      'fields.Vendor': '{{input.input.vendor}}',
      'fields.Invoice': '{{input.input.invoiceNumber}}',
      'fields.Amount': '{{input.input.amount}}',
      'fields.Due': '{{input.input.dueDate}}',
      'fields.Status': 'Approved',
    })
    .tool('saveA', 6, -1.5, 'Add to payables', 'airtable', 'create_record', { base: 'Finance', table: 'Payables', fields: '{{input.fields}}' })
    .tool('tellA', 7, -1.5, 'Tell #finance', 'slack', 'post_message', { channel: '#finance', text: 'Invoice approved and added to payables ({{input.id}}).' })
    .tool('tellNo', 5, -0.5, 'Tell #finance it was rejected', 'slack', 'post_message', {
      channel: '#finance',
      text: 'An incoming supplier invoice was rejected in review - check with the requester before paying it.',
    })
    .transform('recordB', 4, 1, 'Prepare the payable', {
      'fields.Vendor': '{{input.vendor}}',
      'fields.Invoice': '{{input.invoiceNumber}}',
      'fields.Amount': '{{input.amount}}',
      'fields.Due': '{{input.dueDate}}',
      'fields.Status': 'Auto-approved',
    })
    .tool('saveB', 5, 1, 'Add to payables', 'airtable', 'create_record', { base: 'Finance', table: 'Payables', fields: '{{input.fields}}' })
    .end('e', 8, 0)
    .chain('s', 'extract', 'norm', 'big')
    .yes('big', 'ap')
    .no('big', 'recordB')
    .approved('ap', 'recordA')
    .rejected('ap', 'tellNo')
    .chain('recordA', 'saveA', 'tellA')
    .chain('recordB', 'saveB')
    .edge('tellA', 'e').edge('tellNo', 'e').edge('saveB', 'e')
    .done(),
};

const supportTriage = {
  key: 'support-ticket-triage',
  name: 'Support email triage',
  category: 'Customer support',
  icon: 'LifeBuoy',
  summary: 'An AI router hands each support email to the right specialist and opens the ticket.',
  useCase: 'A shared support inbox mixes billing disputes, bug reports and sales questions, and a person has to sort every email. '
    + 'A routing agent reads each one and hands it to a billing, technical or sales specialist, which opens a Jira ticket '
    + 'or alerts #sales, and the customer gets an acknowledgement straight away.',
  tags: ['multi-agent', 'handoff', 'jira', 'email'],
  difficulty: 'advanced',
  estimatedSetupMinutes: 15,
  requiredIntegrations: ['email', 'jira', 'slack'],
  trigger: { type: 'event', eventName: 'email.email_received' },
  sampleInput: envelope('email.email_received', {
    from: 'dana@initech.test',
    to: 'support@acme.test',
    subject: 'Charged twice this month',
    text: 'Hi, I was charged twice for my subscription this month. Can you refund the duplicate billing charge?',
  }),
  ...graph()
    .start('s', 0, 0, 'Support email received')
    .agent('route', 1, 0, 'Route the request', 'You triage inbound support email. Pick exactly one team: '
      + 'billing (charges, invoices, refunds), technical (bugs, errors, outages) or sales (pricing, upgrades, demos).', {
      isHandoff: true,
      candidates: ['billing', 'technical', 'sales'],
    })
    .agent('billing', 2, -1, 'Billing specialist', 'Summarise the billing problem in one sentence for a ticket title, '
      + 'including any amounts, invoice numbers or dates the customer mentioned.')
    .agent('technical', 2, 0, 'Technical support', 'Summarise the technical problem in one sentence for a bug title: '
      + 'what is broken, where, and since when.')
    .agent('sales', 2, 1, 'Sales enquiry', 'Summarise what the prospect wants in one sentence: product, seats and timeline if given.')
    .tool('billTicket', 3, -1, 'Open a billing ticket', 'jira', 'create_ticket', { project: 'BILL', summary: '{{input.reply}}', type: 'Task' })
    .tool('bugTicket', 3, 0, 'Open a bug ticket', 'jira', 'create_ticket', { project: 'SUP', summary: '{{input.reply}}', type: 'Bug' })
    .tool('salesPing', 3, 1, 'Alert #sales', 'slack', 'post_message', { channel: '#sales', text: 'New enquiry from the support inbox: {{input.reply}}' })
    .transform('ack', 4, 0, 'Compose acknowledgement', {
      to: '{{run.input.data.from}}',
      subject: 'Re: {{run.input.data.subject}}',
      body: "Thanks for getting in touch - we've passed this to the right team and will reply within one business day.",
    })
    .tool('reply', 5, 0, 'Acknowledge the customer', 'email', 'send', { to: '{{input.to}}', subject: '{{input.subject}}', body: '{{input.body}}' })
    .end('e', 6, 0)
    .edge('s', 'route')
    .edge('route', 'billing', { label: 'billing' })
    .edge('route', 'technical', { label: 'technical' })
    .edge('route', 'sales', { label: 'sales' })
    .edge('billing', 'billTicket').edge('technical', 'bugTicket').edge('sales', 'salesPing')
    .edge('billTicket', 'ack').edge('bugTicket', 'ack').edge('salesPing', 'ack')
    .chain('ack', 'reply', 'e')
    .done(),
};

const kbAnswerBot = {
  key: 'kb-answer-bot',
  name: 'Knowledge-base answer bot',
  category: 'Customer support',
  icon: 'BookOpen',
  summary: 'Answer questions in Slack from your own docs, and page a human when the docs don\'t cover it.',
  useCase: 'The same internal questions ("what\'s our refund policy for annual plans?") get asked in Slack every week. '
    + 'This searches the workspace knowledge base, has an agent answer only from what it found, and replies in the thread - '
    + 'or hands off to the on-call support person when nothing relevant turns up.',
  tags: ['slack', 'knowledge base', 'rag', 'agent'],
  difficulty: 'intermediate',
  estimatedSetupMinutes: 10,
  requiredIntegrations: ['slack', 'knowledge'],
  trigger: { type: 'event', eventName: 'slack.message_received' },
  sampleInput: envelope('slack.message_received', {
    channel: '#help',
    user: 'U024BE7LH',
    text: 'What is our refund policy for annual plans?',
    ts: '1727000000.000100',
  }),
  ...graph()
    .start('s', 0, 0, 'Question asked in Slack')
    .tool('search', 1, 0, 'Search the knowledge base', 'knowledge', 'search', { query: '{{input.data.text}}', topK: 3 })
    .condition('found', 2, 0, 'Anything relevant?', 'Array.isArray(output.results) && output.results.length > 0')
    .agent('answer', 3, -1, 'Answer from the docs', 'Answer the question using only the knowledge-base excerpts you are given. '
      + "Name the document you used. If the excerpts don't answer it, say so plainly and suggest who to ask.")
    .transform('thread', 4, -1, 'Reply in the thread', {
      channel: '{{run.input.data.channel}}',
      threadTs: '{{run.input.data.ts}}',
      text: '{{input.reply}}',
    })
    .tool('post', 5, -1, 'Post the answer', 'slack', 'post_to_thread', { channel: '{{input.channel}}', threadTs: '{{input.threadTs}}', text: '{{input.text}}' })
    .transform('human', 3, 1, 'Hand off to a human', {
      channel: '{{run.input.data.channel}}',
      threadTs: '{{run.input.data.ts}}',
      text: "I couldn't find this in our docs - paging @support-oncall to help.",
    })
    .tool('page', 4, 1, 'Page support on-call', 'slack', 'post_to_thread', { channel: '{{input.channel}}', threadTs: '{{input.threadTs}}', text: '{{input.text}}' })
    .end('e', 6, 0)
    .chain('s', 'search', 'found')
    .yes('found', 'answer')
    .no('found', 'human')
    .chain('answer', 'thread', 'post', 'e')
    .chain('human', 'page', 'e')
    .done(),
};

const csatFollowUp = {
  key: 'csat-follow-up',
  name: 'CSAT follow-up',
  category: 'Customer support',
  icon: 'Smile',
  summary: 'Escalate unhappy survey responses the same day; ask happy customers for a review.',
  useCase: 'Satisfaction scores get collected and then ignored. Every survey response is logged to a sheet; '
    + 'a score of 2 or less opens a CX escalation in Jira and alerts #cx-leads, while happy customers get a '
    + 'polite review request the next day.',
  tags: ['csat', 'jira', 'sheets', 'delay'],
  difficulty: 'intermediate',
  estimatedSetupMinutes: 10,
  requiredIntegrations: ['sheets', 'jira', 'slack', 'email'],
  trigger: { type: 'webhook' },
  sampleInput: {
    ticketId: 'SUP-311',
    customerName: 'Kim',
    customerEmail: 'kim@tailspin.test',
    agent: 'Priya',
    score: 2,
    comment: 'Took four days to get an answer.',
  },
  ...graph()
    .start('s', 0, 0, 'Survey response received')
    .transform('norm', 1, 0, 'Normalise the response', {
      ticketId: '{{run.input.ticketId}}',
      name: '{{run.input.customerName}}',
      email: '{{run.input.customerEmail}}',
      score: '{{run.input.score}}',
      comment: '{{run.input.comment}}',
    })
    .tool('log', 2, -1, 'Log to the CSAT sheet', 'sheets', 'append_row', {
      spreadsheet: 'CSAT responses',
      sheet: 'Responses',
      values: '["{{input.ticketId}}", "{{input.email}}", {{input.score}}]',
    })
    .condition('unhappy', 2, 1, 'Unhappy? (score ≤ 2)', 'Number(output.score) <= 2')
    .tool('ticket', 3, 0.5, 'Open an escalation', 'jira', 'create_ticket', {
      project: 'CX',
      summary: 'Low CSAT on {{input.ticketId}} ({{input.score}}/5) from {{input.name}}',
      type: 'Task',
    })
    .tool('progress', 4, 0.5, 'Move to In Progress', 'jira', 'transition_ticket', { key: '{{input.key}}', status: 'In Progress' })
    .tool('alert', 5, 0.5, 'Alert #cx-leads', 'slack', 'post_message', {
      channel: '#cx-leads',
      text: 'Escalated {{input.key}}: an unhappy customer needs a call today.',
    })
    .delay('wait', 3, 1.5, 'Wait a day', 24 * HOUR)
    .tool('review', 4, 1.5, 'Ask for a review', 'email', 'send', {
      to: '{{input.email}}',
      subject: 'Glad we could help!',
      body: 'Hi {{input.name}}, thanks for the kind rating. Would you share it on G2? https://g2.com/products/acme/reviews',
    })
    .end('e', 6, 0)
    .edge('s', 'norm')
    .edge('norm', 'log')
    .edge('norm', 'unhappy')
    .yes('unhappy', 'ticket')
    .no('unhappy', 'wait')
    .chain('ticket', 'progress', 'alert')
    .chain('wait', 'review')
    .edge('log', 'e').edge('alert', 'e').edge('review', 'e')
    .done(),
};

const leadEnrichment = {
  key: 'lead-enrichment-routing',
  name: 'Inbound lead enrichment & routing',
  category: 'Sales & marketing',
  icon: 'UserPlus',
  summary: 'Enrich demo requests, score them, add them to HubSpot and alert sales about hot ones in minutes.',
  useCase: 'Demo requests from the website sit in a queue while the best leads cool off. '
    + 'Each form submission is enriched over HTTP, scored hot/warm/cold by AI, created as a HubSpot contact, '
    + 'and hot leads page #sales and the on-duty SDR immediately - everyone else gets a nurture email.',
  tags: ['hubspot', 'lead scoring', 'http', 'ai'],
  difficulty: 'intermediate',
  estimatedSetupMinutes: 15,
  requiredIntegrations: ['http', 'ai', 'hubspot', 'slack', 'email'],
  trigger: { type: 'webhook' },
  sampleInput: {
    email: 'hank@globex.test',
    firstName: 'Hank',
    lastName: 'Scorpio',
    company: 'Globex',
    companySize: 850,
    message: 'We need SSO and audit logs for 800 seats - this is a hot priority, can we book a demo this week?',
  },
  ...graph()
    .start('s', 0, 0, 'Demo form submitted')
    .tool('enrich', 1, 0, 'Enrich the company', 'http', 'request', {
      url: 'https://api.enrichment.example/v1/person?email={{input.email}}',
      method: 'GET',
    })
    .tool('score', 2, 0, 'Score the lead', 'ai', 'classify', {
      labels: 'hot, warm, cold',
      instructions: 'hot = 200+ employees or an explicit demo or pricing request; warm = a clear use case; cold = students, spam or no company.',
    })
    .transform('prep', 3, 0, 'Prepare the contact', {
      email: '{{run.input.email}}',
      firstName: '{{run.input.firstName}}',
      lastName: '{{run.input.lastName}}',
      company: '{{run.input.company}}',
      tier: '{{input.label}}',
    })
    .tool('crm', 4, -1, 'Create HubSpot contact', 'hubspot', 'create_contact', {
      email: '{{input.email}}', firstName: '{{input.firstName}}', lastName: '{{input.lastName}}',
    })
    .condition('hot', 4, 1, 'Hot lead?', 'output.tier === "hot"')
    .tool('ping', 5, 0.5, 'Alert #sales', 'slack', 'post_message', {
      channel: '#sales',
      text: 'Hot lead: {{input.firstName}} {{input.lastName}} at {{input.company}} ({{input.email}}) - reply within the hour.',
    })
    .tool('sdr', 5, 1.5, 'Email the on-duty SDR', 'email', 'send', {
      to: 'sdr-oncall@acme.test',
      subject: 'Hot lead: {{input.company}}',
      body: '{{input.firstName}} {{input.lastName}} ({{input.email}}) from {{input.company}} just asked for a demo.',
    })
    .tool('nurture', 5, 2.5, 'Send a nurture email', 'email', 'send', {
      to: '{{input.email}}',
      subject: 'Thanks for your interest in Acme',
      body: 'Hi {{input.firstName}}, here are three customer stories from teams like {{input.company}}: https://acme.example/stories',
    })
    .end('e', 6, 0)
    .chain('s', 'enrich', 'score', 'prep')
    .edge('prep', 'crm')
    .edge('prep', 'hot')
    .yes('hot', 'ping')
    .yes('hot', 'sdr')
    .no('hot', 'nurture')
    .edge('crm', 'e').edge('ping', 'e').edge('sdr', 'e').edge('nurture', 'e')
    .done(),
};

const nudgeOneTrial = {
  key: 'nudge-one-trial',
  companion: true,
  name: 'Nudge one trial account',
  category: 'Sales & marketing',
  icon: 'Mail',
  summary: 'Loop body: writes and sends a trial nudge to one account, if it is still on a trial.',
  useCase: 'Used by "Trial-to-paid nudges" as its loop body - one run per account. '
    + 'It checks the account is on a trial, drafts a friendly nudge and emails the account owner.',
  tags: ['companion', 'loop body', 'email'],
  difficulty: 'starter',
  estimatedSetupMinutes: 2,
  requiredIntegrations: ['ai', 'email'],
  trigger: { type: 'manual' },
  sampleInput: { item: { id: 'rec1', fields: { Name: 'Globex', Stage: 'Trial', Seats: 12, Email: 'it@globex.test' } }, index: 0, total: 1 },
  ...graph()
    .start('s', 0, 0, 'For one account')
    .condition('trial', 1, 0, 'On a trial?', 'Boolean(output.item && output.item.fields && output.item.fields.Stage === "Trial")')
    .tool('draft', 2, -1, 'Write the nudge', 'ai', 'draft_reply', { tone: 'friendly' })
    .transform('compose', 3, -1, 'Address the email', {
      to: '{{run.input.item.fields.Email}}',
      subject: 'Your trial ends soon - want a hand getting set up?',
      body: '{{input.reply}}\n\nBook 20 minutes with us: https://acme.example/onboarding-call',
    })
    .tool('send', 4, -1, 'Send the nudge', 'email', 'send', { to: '{{input.to}}', subject: '{{input.subject}}', body: '{{input.body}}' })
    .end('e', 5, 0)
    .edge('s', 'trial')
    .yes('trial', 'draft')
    .no('trial', 'e')
    .chain('draft', 'compose', 'send', 'e')
    .done(),
};

const trialNudges = {
  key: 'trial-to-paid-nudges',
  name: 'Trial-to-paid nudges',
  category: 'Sales & marketing',
  icon: 'Rocket',
  summary: 'Every weekday, send each trial account a personal nudge before the trial runs out.',
  useCase: 'Most trials expire without anyone from the company getting in touch. '
    + 'Each weekday morning this reads the accounts table, runs "Nudge one trial account" for every account '
    + '(three at a time), and posts a summary in #growth. "Use template" also creates and publishes that loop body.',
  tags: ['airtable', 'loop', 'sub-workflow', 'email', 'schedule'],
  difficulty: 'intermediate',
  estimatedSetupMinutes: 10,
  requiredIntegrations: ['airtable', 'ai', 'email', 'slack'],
  companions: ['nudge-one-trial'],
  trigger: { type: 'schedule', cronExpression: '0 10 * * 1-5' },
  sampleInput: {},
  ...graph()
    .start('s', 0, 0, 'Every weekday at 10:00')
    .tool('load', 1, 0, 'Load accounts', 'airtable', 'list_records', { base: 'CRM', table: 'Accounts' })
    .loop('each', 2, 0, 'Nudge each trial account', { itemsPath: '{{input.records}}', companion: 'nudge-one-trial', concurrency: 3 })
    .tool('report', 3, 0, 'Post a summary', 'slack', 'post_message', {
      channel: '#growth',
      text: 'Trial nudges finished: {{input.succeeded}} of {{input.total}} accounts processed ({{input.failed}} failed).',
    })
    .end('e', 4, 0)
    .chain('s', 'load', 'each', 'report', 'e')
    .done(),
};

const pipelineDigest = {
  key: 'weekly-pipeline-digest',
  name: 'Weekly pipeline digest',
  category: 'Sales & marketing',
  icon: 'BarChart3',
  summary: 'Monday-morning pipeline summary in Notion and Slack, written by AI from the deals sheet.',
  useCase: 'Pipeline reviews start with ten minutes of someone reading the spreadsheet aloud. '
    + 'Every Monday this reads the deals sheet, has AI write a short summary of what moved, saves it to the '
    + 'Sales reviews database in Notion and posts it to #sales.',
  tags: ['sheets', 'notion', 'summary', 'schedule'],
  difficulty: 'starter',
  estimatedSetupMinutes: 5,
  requiredIntegrations: ['sheets', 'ai', 'notion', 'slack'],
  trigger: { type: 'schedule', cronExpression: '0 8 * * 1' },
  sampleInput: {},
  ...graph()
    .start('s', 0, 0, 'Every Monday at 08:00')
    .tool('read', 1, 0, 'Read the pipeline sheet', 'sheets', 'read_rows', { spreadsheet: 'Sales pipeline', sheet: 'Deals', limit: 50 })
    .tool('sum', 2, 0, 'Summarise the week', 'ai', 'summarize', { maxWords: 80 })
    .tool('page', 3, -0.5, 'Save to Notion', 'notion', 'create_page', { database: 'Sales reviews', title: 'Weekly pipeline digest' })
    .tool('post', 3, 0.5, 'Post to #sales', 'slack', 'post_message', { channel: '#sales', text: "This week's pipeline: {{input.summary}}" })
    .end('e', 4, 0)
    .chain('s', 'read', 'sum')
    .edge('sum', 'page').edge('sum', 'post')
    .edge('page', 'e').edge('post', 'e')
    .done(),
};

const githubTriage = {
  key: 'github-issue-triage',
  name: 'GitHub issue triage',
  category: 'Engineering & DevOps',
  icon: 'Github',
  summary: 'Label new GitHub issues with AI, track them in Linear and escalate security reports.',
  useCase: 'Public issue trackers fill up faster than maintainers can read them, and a security report can sit next to a feature request for days. '
    + 'Each new issue is classified by AI; security reports alert #security immediately, and everything else '
    + 'becomes a Linear issue while the reporter gets a thank-you comment.',
  tags: ['github', 'linear', 'classification', 'open source'],
  difficulty: 'intermediate',
  estimatedSetupMinutes: 10,
  requiredIntegrations: ['github', 'ai', 'linear', 'slack'],
  trigger: { type: 'event', eventName: 'github.issue_opened' },
  sampleInput: envelope('github.issue_opened', {
    repo: 'acme/web',
    number: 3,
    title: 'Order confirmation email shows the wrong currency',
    body: 'Looks like a bug: EU customers see USD in the confirmation email since the last release.',
    url: 'https://github.com/acme/web/issues/3',
    author: 'priya-s',
  }),
  ...graph()
    .start('s', 0, 0, 'Issue opened on GitHub')
    .tool('cls', 1, 0, 'Classify the issue', 'ai', 'classify', {
      labels: 'bug, feature, question, security',
      instructions: 'security = anything about vulnerabilities, leaked credentials or unauthorised access.',
    })
    .transform('prep', 2, 0, 'Prepare the issue', {
      repo: '{{run.input.data.repo}}',
      number: '{{run.input.data.number}}',
      title: '{{run.input.data.title}}',
      url: '{{run.input.data.url}}',
      label: '{{input.label}}',
    })
    .condition('sec', 3, 0, 'Security report?', 'output.label === "security"')
    .tool('alert', 4, -1, 'Alert #security', 'slack', 'post_message', {
      channel: '#security',
      text: 'Possible security report on GitHub: {{input.title}} {{input.url}} - move it to a private advisory.',
    })
    .tool('track', 4, 0.5, 'Create a Linear issue', 'linear', 'create_issue', { team: 'ENG', title: '[{{input.label}}] {{input.title}}', priority: '3' })
    .tool('thank', 4, 1.5, 'Thank the reporter', 'github', 'comment', {
      repo: '{{input.repo}}',
      number: '{{input.number}}',
      body: "Thanks for the report! We've triaged this as a {{input.label}} and are tracking it internally.",
    })
    .end('e', 5, 0)
    .chain('s', 'cls', 'prep', 'sec')
    .yes('sec', 'alert')
    .no('sec', 'track')
    .no('sec', 'thank')
    .edge('alert', 'e').edge('track', 'e').edge('thank', 'e')
    .done(),
};

const incidentEscalation = {
  key: 'incident-alert-escalation',
  name: 'Incident alert escalation',
  category: 'Engineering & DevOps',
  icon: 'Siren',
  summary: 'Turn monitoring alerts into pages, an incident decision and a tracked ticket.',
  useCase: 'Alerts land in a channel nobody watches at 3 a.m. '
    + 'Critical and high alerts post to #incidents and text the on-call engineer (falling back to email if SMS fails); '
    + 'the on-call then declares - or dismisses - an incident, which opens a ticket. If nobody answers in 15 minutes, the incident is declared automatically.',
  tags: ['on-call', 'twilio', 'jira', 'approval', 'error branch'],
  difficulty: 'advanced',
  estimatedSetupMinutes: 20,
  requiredIntegrations: ['slack', 'twilio', 'jira', 'email'],
  trigger: { type: 'webhook' },
  sampleInput: {
    service: 'checkout-api',
    severity: 'critical',
    summary: 'Error rate above 5% for 10 minutes',
    dashboardUrl: 'https://grafana.example/d/checkout',
    oncallPhone: '+14155550123',
  },
  ...graph()
    .start('s', 0, 0, 'Monitoring alert')
    .transform('norm', 1, 0, 'Normalise the alert', {
      service: '{{run.input.service}}',
      severity: '{{run.input.severity}}',
      summary: '{{run.input.summary}}',
      url: '{{run.input.dashboardUrl}}',
      phone: '{{run.input.oncallPhone}}',
    })
    .condition('sev', 2, 0, 'Critical or high?', 'output.severity === "critical" || output.severity === "high"')
    .tool('post', 3, -1, 'Post to #incidents', 'slack', 'post_message', {
      channel: '#incidents',
      text: '{{input.severity}} alert on {{input.service}}: {{input.summary}} {{input.url}}',
    })
    .tool('sms', 3, -2, 'Text the on-call engineer', 'twilio', 'send_sms', {
      to: '{{input.phone}}',
      body: '{{input.severity}} on {{input.service}}: {{input.summary}}. Ack in #incidents.',
    })
    .tool('fallback', 4, -2.5, 'Email on-call if SMS fails', 'email', 'send', {
      to: 'oncall@acme.test',
      subject: 'Page failed - check #incidents',
      body: 'The SMS page for an alert could not be delivered. Please check #incidents now.',
    })
    .approval('declare', 4, -1, 'Declare an incident?', {
      title: 'Declare an incident for {{run.input.service}}?',
      description: '{{run.input.severity}}: {{run.input.summary}} - {{run.input.dashboardUrl}}',
      roles: ['owner', 'admin', 'editor'],
      timeout: { afterMs: 15 * 60 * 1000, outcome: 'approved' },
    })
    .transform('inc', 5, -1.5, 'Prepare the incident', {
      summary: '{{run.input.severity}} incident: {{run.input.service}} - {{run.input.summary}}',
    })
    .tool('ticket', 6, -1.5, 'Open an incident ticket', 'jira', 'create_ticket', { project: 'INC', summary: '{{input.summary}}', type: 'Bug' })
    .tool('stand', 5, -0.5, 'Stand down', 'slack', 'post_message', { channel: '#incidents', text: 'On-call reviewed the alert - not an incident.' })
    .tool('low', 3, 1, 'Log to #alerts-low', 'slack', 'post_message', {
      channel: '#alerts-low',
      text: '{{input.severity}} alert on {{input.service}}: {{input.summary}}',
    })
    .end('e', 7, 0)
    .chain('s', 'norm', 'sev')
    .yes('sev', 'post')
    .yes('sev', 'sms')
    .no('sev', 'low')
    .onError('sms', 'fallback')
    .edge('post', 'declare')
    .approved('declare', 'inc')
    .rejected('declare', 'stand')
    .chain('inc', 'ticket', 'e')
    .edge('stand', 'e').edge('sms', 'e').edge('fallback', 'e').edge('low', 'e')
    .done(),
};

const releaseNotes = {
  key: 'release-notes-drafter',
  name: 'Release notes drafter',
  category: 'Engineering & DevOps',
  icon: 'ScrollText',
  summary: "Every Friday, turn the week's closed issues into release notes for Notion and Discord.",
  useCase: 'Release notes get written from memory, late, or not at all. '
    + 'Every Friday afternoon this collects the closed issues, has an agent write customer-facing notes grouped by theme, '
    + 'saves them to Notion and announces them on your community Discord.',
  tags: ['github', 'notion', 'discord', 'agent', 'schedule'],
  difficulty: 'starter',
  estimatedSetupMinutes: 5,
  requiredIntegrations: ['github', 'notion', 'discord'],
  trigger: { type: 'schedule', cronExpression: '0 16 * * 5' },
  sampleInput: {},
  ...graph()
    .start('s', 0, 0, 'Every Friday at 16:00')
    .tool('closed', 1, 0, 'Collect closed issues', 'github', 'list_issues', { repo: 'acme/web', state: 'closed' })
    .agent('write', 2, 0, 'Write the release notes', 'Write customer-facing release notes from these closed GitHub issues. '
      + 'Group them under New, Improved and Fixed, one short line each, in plain language. Skip internal chores.')
    .tool('page', 3, -0.5, 'Save to Notion', 'notion', 'create_page', { database: 'Release notes', title: "This week's release notes" })
    .tool('announce', 3, 0.5, 'Announce on Discord', 'discord', 'send_embed', { title: 'This week at Acme', description: '{{input.reply}}' })
    .end('e', 4, 0)
    .chain('s', 'closed', 'write')
    .edge('write', 'page').edge('write', 'announce')
    .edge('page', 'e').edge('announce', 'e')
    .done(),
};

const dailyOpsReport = {
  key: 'daily-ops-report',
  name: 'Daily ops report',
  category: 'Operations',
  icon: 'ClipboardList',
  summary: 'Combine orders and open bugs into one AI-written morning report for Slack and email.',
  useCase: 'Every morning someone pulls numbers from three tools to answer "how are we doing?". '
    + 'On weekdays this reads the orders sheet and the open GitHub bugs in parallel, merges them, has AI write a '
    + 'short report, and sends it to #ops and the leadership list.',
  tags: ['merge', 'parallel', 'summary', 'schedule'],
  difficulty: 'starter',
  estimatedSetupMinutes: 5,
  requiredIntegrations: ['sheets', 'github', 'ai', 'slack', 'email'],
  trigger: { type: 'schedule', cronExpression: '0 9 * * 1-5' },
  sampleInput: {},
  ...graph()
    .start('s', 0, 0, 'Every weekday at 09:00')
    .tool('orders', 1, -0.5, "Read yesterday's orders", 'sheets', 'read_rows', { spreadsheet: 'Orders', sheet: 'Daily', limit: 100 })
    .tool('bugs', 1, 0.5, 'Open bugs', 'github', 'list_issues', { repo: 'acme/web', state: 'open' })
    .merge('combine', 2, 0, 'Combine the data', 'all')
    .tool('sum', 3, 0, 'Write the report', 'ai', 'summarize', { maxWords: 120 })
    .tool('post', 4, -0.5, 'Post to #ops', 'slack', 'post_message', { channel: '#ops', text: 'Daily ops report: {{input.summary}}' })
    .tool('mail', 4, 0.5, 'Email leadership', 'email', 'send', { to: 'leadership@acme.test', subject: 'Daily ops report', body: '{{input.summary}}' })
    .end('e', 5, 0)
    .edge('s', 'orders').edge('s', 'bugs')
    .edge('orders', 'combine').edge('bugs', 'combine')
    .chain('combine', 'sum')
    .edge('sum', 'post').edge('sum', 'mail')
    .edge('post', 'e').edge('mail', 'e')
    .done(),
};

const orderSync = {
  key: 'order-sync',
  name: 'Order sync with failure alerts',
  category: 'Operations',
  icon: 'ShoppingCart',
  summary: 'Record every successful Stripe payment in the orders sheet and database, and email a receipt.',
  useCase: 'Finance reconciles Stripe against a spreadsheet by hand, and rows go missing when an export breaks. '
    + 'Every successful payment is appended to the Orders sheet (with an alert to #ops if that write fails), '
    + 'stored in the orders database, and the customer gets a receipt.',
  tags: ['stripe', 'sheets', 'database', 'error branch'],
  difficulty: 'starter',
  estimatedSetupMinutes: 5,
  requiredIntegrations: ['stripe', 'sheets', 'database', 'email', 'slack'],
  trigger: { type: 'event', eventName: 'stripe.payment_succeeded' },
  sampleInput: envelope('stripe.payment_succeeded', {
    paymentId: 'pi_3Pz8Yq2eZvKYlo2C',
    amount: 4900,
    currency: 'usd',
    customer: 'cus_Q3m2Xk9LpTz4Vw',
    customerEmail: 'jane@northwind.test',
    description: 'Pro plan - monthly',
    status: 'succeeded',
  }),
  ...graph()
    .start('s', 0, 0, 'Payment succeeded')
    .tool('row', 1, -1, 'Append to the Orders sheet', 'sheets', 'append_row', {
      spreadsheet: 'Orders',
      sheet: 'Stripe',
      values: '["{{input.receivedAt}}", "{{input.data.paymentId}}", "{{input.data.customerEmail}}", {{input.data.amount}}, "{{input.data.currency}}"]',
    })
    .tool('alert', 2, -1.5, 'Alert #ops', 'slack', 'post_message', {
      channel: '#ops',
      text: 'A Stripe payment could not be written to the Orders sheet - check the sheet is shared with the integration.',
    })
    .tool('store', 1, 0.5, 'Store the order', 'database', 'insert', {
      collection: 'orders',
      document: '{"paymentId": "{{input.data.paymentId}}", "amount": {{input.data.amount}}, "email": "{{input.data.customerEmail}}", "status": "paid"}',
    })
    .transform('receipt', 2, 0.5, 'Compose the receipt', {
      to: '{{run.input.data.customerEmail}}',
      subject: 'Your receipt from Acme',
      body: 'Thanks! We received {{run.input.data.amount}} {{run.input.data.currency}} (cents) for {{run.input.data.description}}. Reference: {{run.input.data.paymentId}}.',
    })
    .tool('send', 3, 0.5, 'Email the receipt', 'email', 'send', { to: '{{input.to}}', subject: '{{input.subject}}', body: '{{input.body}}' })
    .end('e', 4, 0)
    .edge('s', 'row').edge('s', 'store')
    .onError('row', 'alert')
    .chain('store', 'receipt', 'send')
    .edge('row', 'e').edge('alert', 'e').edge('send', 'e')
    .done(),
};

const remindOneAppointment = {
  key: 'remind-one-appointment',
  companion: true,
  name: 'Remind one appointment',
  category: 'Operations',
  icon: 'Bell',
  summary: 'Loop body: texts one patient a reminder of their appointment.',
  useCase: 'Used by "Appointment reminders" as its loop body - one run per appointment. '
    + 'It writes the reminder from the appointment row and sends it by SMS.',
  tags: ['companion', 'loop body', 'sms'],
  difficulty: 'starter',
  estimatedSetupMinutes: 2,
  requiredIntegrations: ['twilio'],
  trigger: { type: 'manual' },
  sampleInput: { item: { id: 'rec2', fields: { Name: 'Maria Garcia', Phone: '+14155550101', When: 'tomorrow at 10:30', With: 'Dr. Patel' } }, index: 0, total: 1 },
  ...graph()
    .start('s', 0, 0, 'For one appointment')
    .transform('write', 1, 0, 'Write the reminder', {
      to: '{{input.item.fields.Phone}}',
      body: 'Hi {{input.item.fields.Name}}, a reminder of your appointment {{input.item.fields.When}} with {{input.item.fields.With}}. Reply C to confirm or R to reschedule.',
    })
    .tool('sms', 2, 0, 'Send the SMS', 'twilio', 'send_sms', { to: '{{input.to}}', body: '{{input.body}}' })
    .end('e', 3, 0)
    .chain('s', 'write', 'sms', 'e')
    .done(),
};

const appointmentReminders = {
  key: 'appointment-reminders',
  name: 'Appointment reminders',
  category: 'Operations',
  icon: 'CalendarClock',
  summary: "Text every patient the evening before their appointment, and report how many went out.",
  useCase: 'No-shows cost clinics and salons a large share of their booked hours. '
    + 'Every evening this reads tomorrow\'s appointments from Airtable, runs "Remind one appointment" for each '
    + '(five at a time, one failed text never blocks the rest), and tells the front desk how many were sent.',
  tags: ['twilio', 'airtable', 'loop', 'schedule'],
  difficulty: 'intermediate',
  estimatedSetupMinutes: 10,
  requiredIntegrations: ['airtable', 'twilio', 'slack'],
  companions: ['remind-one-appointment'],
  trigger: { type: 'schedule', cronExpression: '0 17 * * *' },
  sampleInput: {},
  ...graph()
    .start('s', 0, 0, 'Every day at 17:00')
    .tool('load', 1, 0, "Load tomorrow's appointments", 'airtable', 'list_records', { base: 'Clinic', table: 'Appointments' })
    .loop('each', 2, 0, 'Remind each patient', { itemsPath: '{{input.records}}', companion: 'remind-one-appointment', concurrency: 5 })
    .tool('report', 3, 0, 'Tell the front desk', 'slack', 'post_message', {
      channel: '#front-desk',
      text: 'Sent {{input.succeeded}} of {{input.total}} appointment reminders ({{input.failed}} failed).',
    })
    .end('e', 4, 0)
    .chain('s', 'load', 'each', 'report', 'e')
    .done(),
};

const provisionOneAccount = {
  key: 'provision-one-account',
  companion: true,
  name: 'Request one account',
  category: 'People & HR',
  icon: 'KeyRound',
  summary: 'Loop body: opens an IT ticket to create one account for a new hire.',
  useCase: 'Used by "Employee onboarding" as its loop body - one run per tool the new hire needs. '
    + 'It opens a Jira ticket for IT naming the tool and the person.',
  tags: ['companion', 'loop body', 'jira'],
  difficulty: 'starter',
  estimatedSetupMinutes: 2,
  requiredIntegrations: ['jira'],
  trigger: { type: 'manual' },
  sampleInput: { item: 'Slack', index: 0, total: 1, parent: { name: 'Alex Morgan', startDate: '2026-10-01' } },
  ...graph()
    .start('s', 0, 0, 'For one account')
    .tool('ticket', 1, 0, 'Open an IT ticket', 'jira', 'create_ticket', {
      project: 'IT',
      summary: 'Create a {{input.item}} account for {{input.parent.name}} (starts {{input.parent.startDate}})',
      type: 'Task',
    })
    .end('e', 2, 0)
    .chain('s', 'ticket', 'e')
    .done(),
};

const employeeOnboarding = {
  key: 'employee-onboarding',
  name: 'Employee onboarding',
  category: 'People & HR',
  icon: 'Users',
  summary: 'When HR adds a new hire, request every account, welcome them in Slack and brief their manager.',
  useCase: 'New hires spend their first morning waiting for logins because account requests went out late. '
    + 'When your HR system posts a new hire, this opens one IT ticket per account they need (via "Request one account"), '
    + 'welcomes them in #general and emails their manager that onboarding is under way.',
  tags: ['onboarding', 'jira', 'loop', 'hr'],
  difficulty: 'intermediate',
  estimatedSetupMinutes: 10,
  requiredIntegrations: ['jira', 'slack', 'email'],
  companions: ['provision-one-account'],
  trigger: { type: 'webhook' },
  sampleInput: {
    name: 'Alex Morgan',
    email: 'alex.morgan@acme.test',
    team: 'Platform',
    startDate: '2026-10-01',
    manager: 'Priya Shah',
    managerEmail: 'priya@acme.test',
    accounts: ['Google Workspace', 'Slack', 'GitHub', 'Jira', '1Password'],
  },
  ...graph()
    .start('s', 0, 0, 'New hire added in HR')
    .loop('each', 1, 0, 'Request each account', { itemsPath: '{{run.input.accounts}}', companion: 'provision-one-account', concurrency: 3 })
    .transform('compose', 2, 0, 'Compose the welcome', {
      welcome: 'Please welcome {{run.input.name}} to the {{run.input.team}} team, starting {{run.input.startDate}}!',
      managerEmail: '{{run.input.managerEmail}}',
      subject: 'Onboarding for {{run.input.name}} is under way',
      body: 'Hi {{run.input.manager}}, IT tickets are open for {{input.succeeded}} of {{input.total}} accounts {{run.input.name}} needs. '
        + 'Please plan their first-week buddy and 1:1s.',
    })
    .tool('welcome', 3, -0.5, 'Welcome in #general', 'slack', 'post_message', { channel: '#general', text: '{{input.welcome}}' })
    .tool('brief', 3, 0.5, 'Brief the manager', 'email', 'send', { to: '{{input.managerEmail}}', subject: '{{input.subject}}', body: '{{input.body}}' })
    .end('e', 4, 0)
    .chain('s', 'each', 'compose')
    .edge('compose', 'welcome').edge('compose', 'brief')
    .edge('welcome', 'e').edge('brief', 'e')
    .done(),
};

const newsMonitor = {
  key: 'competitor-news-monitor',
  name: 'Competitor & news monitor',
  category: 'AI & knowledge',
  icon: 'Newspaper',
  summary: 'Summarise new articles from the feeds you follow and file the relevant ones in Notion.',
  useCase: 'Market news is spread across blogs and press pages nobody has time to read. '
    + 'Each new item from your RSS feeds is summarised and classified by AI; anything about a competitor, customer '
    + 'or your industry is filed in the Market intel database and shared in #market-intel.',
  tags: ['rss', 'notion', 'classification', 'market intel'],
  difficulty: 'starter',
  estimatedSetupMinutes: 5,
  requiredIntegrations: ['rss', 'ai', 'notion', 'slack'],
  trigger: { type: 'event', eventName: 'rss.new_item' },
  sampleInput: envelope('rss.new_item', {
    title: 'Globex launches an AI workflow builder for competitor tracking',
    link: 'https://news.example.com/globex-ai',
    published: 'Wed, 24 Sep 2026 10:00:00 GMT',
    summary: 'Globex, a competitor, announced a visual builder for AI agents aimed at operations teams.',
    feedUrl: 'https://news.example.com/feed',
  }),
  ...graph()
    .start('s', 0, 0, 'New article in a feed')
    .tool('sum', 1, 0, 'Summarise the article', 'ai', 'summarize', { maxWords: 60 })
    .tool('rel', 2, 0, 'Classify relevance', 'ai', 'classify', {
      labels: 'competitor, customer, industry, irrelevant',
      instructions: 'competitor = news about a company we compete with; customer = news about one of our customers.',
    })
    .condition('worth', 3, 0, 'Worth sharing?', 'output.label !== "irrelevant"')
    .transform('prep', 4, -1, 'Prepare the note', {
      title: '{{run.input.data.title}}',
      link: '{{run.input.data.link}}',
      label: '{{input.label}}',
    })
    .tool('file', 5, -1.5, 'File in Market intel', 'notion', 'create_page', {
      database: 'Market intel',
      title: '{{input.title}}',
      properties: '{"Link": "{{input.link}}", "Category": "{{input.label}}"}',
    })
    .tool('share', 5, -0.5, 'Share in #market-intel', 'slack', 'post_message', {
      channel: '#market-intel',
      text: '{{input.label}} news: {{input.title}} {{input.link}}',
    })
    .end('e', 6, 0)
    .chain('s', 'sum', 'rel', 'worth')
    .yes('worth', 'prep')
    .no('worth', 'e')
    .edge('prep', 'file').edge('prep', 'share')
    .edge('file', 'e').edge('share', 'e')
    .done(),
};

const scoreOneCustomer = {
  key: 'score-one-customer',
  companion: true,
  name: 'Score one customer',
  category: 'AI & knowledge',
  icon: 'Gauge',
  summary: 'Loop body: computes a churn-risk score for one account and alerts CS if it is high.',
  useCase: 'Used by "Churn risk scoring" as its loop body - one run per account. '
    + 'A small Code node turns the account row into a 0–100 risk score; high-risk accounts alert #customer-success.',
  tags: ['companion', 'loop body', 'code'],
  difficulty: 'advanced',
  estimatedSetupMinutes: 2,
  requiredIntegrations: ['slack'],
  trigger: { type: 'manual' },
  sampleInput: { item: { id: 'rec3', fields: { Name: 'Globex', Stage: 'Trial', Seats: 4, Email: 'it@globex.test' } }, index: 0, total: 1 },
  ...graph()
    .start('s', 0, 0, 'For one account')
    .code('score', 1, 0, 'Compute the risk score', [
      'const f = (input && input.item && input.item.fields) || {};',
      'const seats = Number(f.Seats) || 0;',
      'let score = 0;',
      "if (f.Stage === 'Trial') score += 40;",
      "if (f.Stage === 'Lead') score += 20;",
      'if (seats < 10) score += 30;',
      'if (!f.Email) score += 10;',
      "const risk = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';",
      'return { name: f.Name || "Unknown account", email: f.Email || null, stage: f.Stage || null, seats, score, risk };',
    ].join('\n'))
    .condition('high', 2, 0, 'High risk?', 'output.risk === "high"')
    .tool('alert', 3, -1, 'Alert #customer-success', 'slack', 'post_message', {
      channel: '#customer-success',
      text: 'Churn risk: {{input.name}} scored {{input.score}}/100 ({{input.stage}}, {{input.seats}} seats) - reach out this week.',
    })
    .end('e', 4, 0)
    .chain('s', 'score', 'high')
    .yes('high', 'alert')
    .no('high', 'e')
    .edge('alert', 'e')
    .done(),
};

const churnScoring = {
  key: 'churn-risk-scoring',
  name: 'Churn risk scoring',
  category: 'AI & knowledge',
  icon: 'TrendingDown',
  summary: 'Score every account for churn risk each Monday and alert customer success about the risky ones.',
  useCase: 'Customer-success teams find out an account was unhappy when it cancels. '
    + 'Every Monday this scores each account with "Score one customer" (a transparent, editable Code-node rule), '
    + 'alerts CS about high-risk accounts, and posts a summary. Needs the code:author permission (owner or admin) to use.',
  tags: ['churn', 'code', 'loop', 'customer success', 'schedule'],
  difficulty: 'advanced',
  estimatedSetupMinutes: 15,
  requiredIntegrations: ['airtable', 'slack'],
  companions: ['score-one-customer'],
  trigger: { type: 'schedule', cronExpression: '0 7 * * 1' },
  sampleInput: {},
  ...graph()
    .start('s', 0, 0, 'Every Monday at 07:00')
    .tool('load', 1, 0, 'Load customer accounts', 'airtable', 'list_records', { base: 'CRM', table: 'Accounts' })
    .loop('each', 2, 0, 'Score each account', { itemsPath: '{{input.records}}', companion: 'score-one-customer', concurrency: 3 })
    .tool('report', 3, 0, 'Post the summary', 'slack', 'post_message', {
      channel: '#customer-success',
      text: 'Weekly churn scoring finished for {{input.total}} accounts ({{input.failed}} could not be scored).',
    })
    .end('e', 4, 0)
    .chain('s', 'load', 'each', 'report', 'e')
    .done(),
};

// Main templates in gallery order; companions last (the gallery shows them
// under their parent rather than as starting points).
export const BUILT_IN_TEMPLATES = [
  failedPaymentRecovery,
  supportTriage,
  leadEnrichment,
  githubTriage,
  incidentEscalation,
  refundApproval,
  invoiceIntake,
  kbAnswerBot,
  csatFollowUp,
  trialNudges,
  pipelineDigest,
  releaseNotes,
  dailyOpsReport,
  orderSync,
  appointmentReminders,
  employeeOnboarding,
  newsMonitor,
  churnScoring,
  nudgeOneTrial,
  remindOneAppointment,
  provisionOneAccount,
  scoreOneCustomer,
].map((template, order) => ({ order, companion: false, companions: [], tags: [], ...template, triggerType: template.trigger.type }));

/** Integrations a graph's tool nodes use (for the gallery's "uses" row). */
export function integrationsUsed(nodes = []) {
  return [...new Set(nodes.filter((n) => n.type === 'tool').map((n) => n.data?.config?.integration).filter(Boolean))];
}
