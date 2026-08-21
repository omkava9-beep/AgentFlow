# Plan: Real-Time Monitoring

**Spec:** [`spec/09-realtime-monitoring.md`](../spec/09-realtime-monitoring.md)
**Depends on:** `06-execution-engine`

## Backend Tasks

- [ ] `sockets/index.js` — Socket.io server setup, attached to the HTTP server in `index.js`
- [ ] `run:subscribe` handler — joins the socket to room `run:<runId>`
- [ ] In `engine/executeRun.js` (`06`), replace the stub event emission with real `io.to(`run:${runId}`).emit(...)` calls:
  - [ ] `run:started` on run start
  - [ ] `node:update` on every node status transition (include `output`, `logs`, `durationMs`, `cached` once relevant)
  - [ ] `run:completed` when the run finishes
- [ ] Ensure socket auth/scoping is reasonable (e.g. require the run's `ownerId` to match a token passed during socket handshake) — simple check, not a full socket-auth framework

## Frontend Tasks

- [ ] `hooks/useRunSocket.js` — connects to Socket.io, emits `run:subscribe` for a given `runId`, listens for `node:update`/`run:completed`, updates local state
- [ ] `pages/RunMonitor.jsx` — renders the workflow canvas (read-only) overlaid with live per-node status (color/badge: pending/running/success/failed/skipped) via `useRunSocket`
- [ ] Log panel component — appends `node:update` log lines in order, tagged by node label
- [ ] On `run:completed` — unsubscribe/stop listening, show a summary banner (status + total duration)
- [ ] Reconnect handling — on socket reconnect mid-run, re-fetch current run state via `GET /api/runs/:id` (`11`) then resume live updates

## Verification

- [ ] Starting a run shows nodes transitioning live (pending → running → success/failed) without a page refresh
- [ ] Logs appear in correct order as nodes execute
- [ ] Opening the monitor for an already-finished run shows final state correctly (via REST fallback, not stale socket state)
- [ ] Disconnecting/reconnecting mid-run resumes correctly instead of showing stuck statuses
