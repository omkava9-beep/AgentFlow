# Spec: Real-Time Monitoring

**Status:** MVP
**Milestone:** M2
**Depends on:** `06-execution-engine.md`

## Summary

Socket.io wiring that streams live per-node status/log updates from the execution engine to the frontend, powering the Run Monitor view: watching a workflow execute node-by-node in real time.

## Goals

- When a run starts, the client joins a room scoped to that run (`run:<runId>`).
- As the execution engine updates a node's status (`pending → running → success/failed/skipped`), emit an event to that room.
- The Run Monitor UI renders each node's live status directly on the canvas (color/badge overlay) and a scrolling log panel.

## Non-goals

- General pub/sub infrastructure beyond this one use case — no need for a generic event bus abstraction.
- Reconnect/replay guarantees beyond "on reconnect, re-fetch current run state via REST then resume live updates" (good enough for a demo).

## Socket Events

| Event | Direction | Payload |
|---|---|---|
| `run:subscribe` | client → server | `{ runId }` — joins the run's room |
| `run:started` | server → client | `{ runId, startedAt }` |
| `node:update` | server → client | `{ runId, nodeId, status, output?, logs?, durationMs?, cached? }` |
| `run:completed` | server → client | `{ runId, status, finishedAt }` |

Namespacing: all events prefixed by concern (`run:*`, `node:*`) per the convention in `CLAUDE.md`.

## UI Behavior

- Run Monitor view overlays each canvas node with a colored border/badge reflecting its latest status (grey=pending, blue pulsing=running, green=success, red=failed, grey-striped=skipped).
- A log panel below/beside the canvas appends `node:update` log lines as they arrive, tagged with node label.
- On `run:completed`, stop listening for that run's events and show a summary banner (success/failed, total duration).

## Edge Cases & Error Handling

- Client opens the Run Monitor after the run already finished — fetch final state via the Run History API (`11`) instead of waiting on socket events that already happened.
- Socket disconnects mid-run — on reconnect, re-subscribe and re-fetch current run state via REST to avoid showing stale statuses.

## Acceptance Criteria

- [ ] Starting a run shows nodes transitioning live from pending → running → success/failed on the canvas without a page refresh.
- [ ] Logs appear in the log panel in the correct order as nodes execute.
- [ ] Refreshing the page mid-run and reopening the monitor resumes showing live updates correctly.
