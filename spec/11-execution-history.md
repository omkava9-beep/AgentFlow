# Spec: Execution History

**Status:** MVP
**Milestone:** M2
**Depends on:** `06-execution-engine.md`

## Summary

A list of past runs for a workflow (or across all of a user's workflows) with a detail view showing the full per-node timeline/log — the record you review after a run has finished, distinct from the live Run Monitor (`09`).

## Goals

- List runs with status, start/finish time, duration, and which workflow they belong to.
- Detail view: same node-by-node breakdown as the live monitor, but read from the persisted `Run` doc rather than sockets.
- Accessible both from a workflow's page ("past runs of this workflow") and optionally a global "all my runs" view.

## Non-goals

- Diffing between two runs of the same workflow.
- Exporting run data (CSV/JSON export) — not required, could be a trivial future add-on.

## API

| Method | Path | Response |
|---|---|---|
| GET | `/api/workflows/:id/runs` | `[{ id, status, startedAt, finishedAt, durationMs }]` |
| GET | `/api/runs/:id` | full `Run` doc including `nodeResults[]` |

Both scoped to `req.userId` via the parent workflow's `ownerId` (or the run's own `ownerId` if denormalized onto `Run` for simpler lookups — reasonable to store `ownerId` directly on `Run` to avoid a join on every list call).

## UI Behavior

- Workflow page has a "Runs" tab/section listing past runs newest-first, each row clickable into the detail view.
- Detail view mirrors the Run Monitor's node-status overlay and log panel, but as a static, already-completed snapshot (no socket subscription needed, though it's fine to reuse the same rendering component fed static data instead of live events).

## Edge Cases & Error Handling

- A run still `pending`/`running` when viewed from History — link into the live Run Monitor (`09`) instead of a static view.
- Very long-running histories (many runs) — basic pagination (e.g. 20 per page) is enough; no need for infinite scroll or virtualization at this scale.

## Acceptance Criteria

- [ ] Past runs for a workflow are listed with correct status/duration.
- [ ] Opening a completed run's detail view shows accurate per-node outputs/logs matching what happened during execution.
- [ ] Opening a still-in-progress run from History routes to the live monitor instead of a stale static view.
