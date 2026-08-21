# Plan: Scheduled Triggers

**Spec:** [`spec/12-scheduled-triggers.md`](../spec/12-scheduled-triggers.md)
**Depends on:** `10-manual-run-trigger`

> **Status: complete.** Verified by `npm run check:triggers` (6 checks: invalid cron rejected,
> valid cron accepted, automatic runs appearing tagged `trigger=schedule`, disabling stopping
> them) plus a restart check — 3 enabled schedules re-registered from MongoDB on boot, and a
> re-registered cron observed firing. The UI half is covered by 6 browser checks (inline
> validation, English description, next-fire time, Enable disabled while invalid, persistence).
>
> Cron description and next-run are a local dependency-free helper (`client/src/utils/cron.js`,
> 11 checks) rather than adding `cronstrue` + `cron-parser` for one panel.

## Backend Tasks

- [x] Extend `models/Workflow.js` with `schedule: { cronExpression, enabled }`
- [x] `PUT /api/workflows/:id/schedule` — validate cron expression (e.g. via `node-cron.validate`), save, register/unregister the live `node-cron` job accordingly
- [x] `DELETE /api/workflows/:id/schedule` — unregister job, clear field
- [x] Refactor `10`'s run-creation logic into a shared internal function (e.g. `services/createAndStartRun(workflowId)`) callable both from the HTTP route and from cron callbacks
- [x] Startup bootstrap (in `index.js` or a `scheduler/bootstrap.js`) — on boot, query all workflows with `schedule.enabled: true`, register a `node-cron` job for each calling `createAndStartRun`
- [x] In-memory registry of active cron jobs (`Map<workflowId, ScheduledTask>`) so enabling/disabling can start/stop the right job without a restart

## Frontend Tasks

- [x] "Schedule" panel in the Builder — cron expression input with a human-readable preview (small cron-to-English helper, e.g. `cronstrue`), enable/disable toggle
- [x] "Next run at" display (computed client-side from the cron expression, e.g. via `cron-parser`)
- [x] Inline validation error for a malformed cron expression before save

## Verification

- [x] Setting an every-minute schedule (for testing) produces automatic runs without manual interaction
- [x] Disabling a schedule stops future automatic runs
- [x] Restarting the server re-registers previously enabled schedules correctly (confirm via logs/next-fire time)
- [x] Invalid cron expression is rejected client- and server-side
