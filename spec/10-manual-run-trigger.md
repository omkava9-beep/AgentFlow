# Spec: Manual Run Trigger

**Status:** MVP
**Milestone:** M2
**Depends on:** `04-workflow-persistence.md`, `06-execution-engine.md`

## Summary

The simplest possible trigger: a "Run" button in the Workflow Builder that starts an execution of the currently saved workflow. Scheduled (`12`) and webhook (`13`) triggers build on the same run-creation path.

## Goals

- Clicking "Run" creates a `Run` document (`status: pending`) and asynchronously kicks off the execution engine (`06`) — the HTTP request returns immediately with the `runId`, it does not block until completion.
- The client is redirected (or the Builder switches mode) into the Run Monitor (`09`) for that `runId`.

## Non-goals

- Passing custom runtime input/parameters into a run (out of scope — every run starts the Start node with no external input for now).
- Cancelling an in-progress run (nice-to-have, not required for MVP).

## API

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/workflows/:id/runs` | — | `202 { runId, status: 'pending' }` |

Internally: validate the workflow has a Start node and no unsaved-cycle issues (defense in depth, even though `02` should have prevented this client-side), create the `Run` doc, then hand off to the execution engine (`06`) without awaiting its completion in the request/response cycle.

## UI Behavior

- "Run" button in the Builder toolbar; disabled while a run for this workflow is already in progress (avoid accidental duplicate runs — one at a time per workflow is enough for this scope).
- On click, shows a brief loading state, then navigates to the Run Monitor for the new `runId`.

## Edge Cases & Error Handling

- Running an unsaved (dirty) workflow — prompt to save first, since the run executes the last-saved graph, not unsaved canvas edits.
- Running a workflow that fails validation (no Start node) — reject with 400 before creating a `Run` doc.

## Acceptance Criteria

- [ ] Clicking "Run" on a valid, saved workflow creates a run and navigates to its live monitor.
- [ ] Clicking "Run" again while one is in progress is prevented/disabled.
- [ ] Running an unsaved workflow prompts to save first rather than silently running stale content.
