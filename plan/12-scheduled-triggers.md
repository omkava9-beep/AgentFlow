# Plan: Scheduled Triggers

**Spec:** [`spec/12-scheduled-triggers.md`](../spec/12-scheduled-triggers.md)
**Depends on:** `10-manual-run-trigger`

## Backend Tasks

- [ ] Extend `models/Workflow.js` with `schedule: { cronExpression, enabled }`
- [ ] `PUT /api/workflows/:id/schedule` — validate cron expression (e.g. via `node-cron.validate`), save, register/unregister the live `node-cron` job accordingly
- [ ] `DELETE /api/workflows/:id/schedule` — unregister job, clear field
- [ ] Refactor `10`'s run-creation logic into a shared internal function (e.g. `services/createAndStartRun(workflowId)`) callable both from the HTTP route and from cron callbacks
- [ ] Startup bootstrap (in `index.js` or a `scheduler/bootstrap.js`) — on boot, query all workflows with `schedule.enabled: true`, register a `node-cron` job for each calling `createAndStartRun`
- [ ] In-memory registry of active cron jobs (`Map<workflowId, ScheduledTask>`) so enabling/disabling can start/stop the right job without a restart

## Frontend Tasks

- [ ] "Schedule" panel in the Builder — cron expression input with a human-readable preview (small cron-to-English helper, e.g. `cronstrue`), enable/disable toggle
- [ ] "Next run at" display (computed client-side from the cron expression, e.g. via `cron-parser`)
- [ ] Inline validation error for a malformed cron expression before save

## Verification

- [ ] Setting an every-minute schedule (for testing) produces automatic runs without manual interaction
- [ ] Disabling a schedule stops future automatic runs
- [ ] Restarting the server re-registers previously enabled schedules correctly (confirm via logs/next-fire time)
- [ ] Invalid cron expression is rejected client- and server-side
