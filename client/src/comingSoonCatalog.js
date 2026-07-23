// Static catalog for the demo: shows the full intended breadth of triggers and
// actions even though only a subset is wired up to real backend logic yet.
// `live: true` entries are functional; everything else renders disabled with
// a "Coming Soon" badge. Flipping something to live is a one-line change here
// plus whatever backend work its spec (spec/12, spec/13, ...) describes.

export const TRIGGER_TYPES = [
  { key: 'manual', label: 'Manual', description: 'Click Run to start the workflow.', live: true },
  { key: 'schedule', label: 'Scheduled (Cron)', description: 'Run automatically on a recurring schedule.', live: false },
  { key: 'webhook', label: 'Webhook', description: 'An external system calls a URL to start a run.', live: false },
  { key: 'event', label: 'External Event', description: 'e.g. new database row, file uploaded, form submitted.', live: false },
];

export const ACTION_TYPES = [
  { type: 'fake-weather', label: 'Fake Weather', live: true },
  { type: 'calculator', label: 'Calculator', live: true },
  { type: 'fake-search', label: 'Fake Search', live: true },
  { type: 'send-email', label: 'Send Email', live: false },
  { type: 'slack-message', label: 'Slack Message', live: false },
  { type: 'http-request', label: 'HTTP Request', live: false },
  { type: 'database-write', label: 'Database Write', live: false },
];
