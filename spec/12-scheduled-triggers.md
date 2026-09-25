# Spec: Scheduled Triggers

**Status:** Stretch
**Milestone:** M3
**Depends on:** `10-manual-run-trigger.md`

> **Revised in phase 3:** Scheduled runs always execute the published version and skip with `not-published` if there is none — see [`30`](30-workflow-versioning.md).

## Summary

Let a workflow run automatically on a recurring cron schedule, using `node-cron` in-process — no external scheduler service.

## Goals

- A workflow can have zero or one active schedule (e.g. `0 * * * *` — every hour) expressed as a standard cron string.
- On each scheduled tick, create a `Run` the same way `10-manual-run-trigger.md` does (reuse that run-creation path, don't duplicate it).
- Schedules persist in MongoDB and are re-registered with `node-cron` on server startup (in-memory cron jobs don't survive a restart otherwise).

## Non-goals

- Sub-minute schedules or complex recurrence rules beyond standard cron syntax.
- Multiple concurrent schedules per workflow (one is enough to demonstrate the concept).
- Distributed/multi-instance-safe scheduling (guarding against double-firing across replicas) — irrelevant at single-process scale.

## Data Model

Add to **Workflow**:
```
schedule: { cronExpression: string, enabled: boolean } | null
```

## API

| Method | Path | Body | Response |
|---|---|---|---|
| PUT | `/api/workflows/:id/schedule` | `{ cronExpression, enabled }` | updated schedule |
| DELETE | `/api/workflows/:id/schedule` | — | `204` |

On server startup, a bootstrap step reads all workflows with `schedule.enabled: true` and registers a `node-cron` job for each, calling the same internal "create + start run" function used by `10`.

## UI Behavior

- Workflow Builder has a "Schedule" panel: cron expression input (with a human-readable preview, e.g. via a small cron-to-English helper) and an enable/disable toggle.
- Shows "next run at" (computed from the cron expression) when enabled.

## Edge Cases & Error Handling

- Invalid cron expression — validate and reject with a clear message before saving.
- Server restart mid-schedule — acceptable to miss at most one tick while restarting; no catch-up/backfill logic needed.

## Acceptance Criteria

- [ ] Setting an hourly schedule and waiting produces automatic runs without manual interaction.
- [ ] Disabling a schedule stops future automatic runs.
- [ ] Schedules still fire correctly after a server restart (re-registered from MongoDB on boot).
