// Static catalog of trigger types. Every entry is live as of phase 2.
//
// Triggers stay listed here because they're a small fixed set the server doesn't
// enumerate. Tool types used to live here too, but they're now served by
// `GET /api/tools` from the server-side ToolRegistry - one source of truth
// instead of a second, staler copy (spec/21).

export const TRIGGER_TYPES = [
  { key: 'manual', label: 'Manual', description: 'Click Run to start the workflow.', live: true },
  { key: 'schedule', label: 'Scheduled (Cron)', description: 'Run automatically on a recurring schedule.', live: true },
  { key: 'webhook', label: 'Webhook', description: 'An external system calls a URL to start a run.', live: true },
  { key: 'event', label: 'External Event', description: 'A named event fans out to every workflow subscribed to it.', live: true },
];
