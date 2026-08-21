# Plan: Engine Parallelism & Run Control

**Spec:** [`spec/19-engine-parallelism-and-control.md`](../spec/19-engine-parallelism-and-control.md)
**Depends on:** `06-execution-engine`, `07-async-job-queue`

Do this plan **first** in phase 2 — it fixes correctness bugs later features would inherit, and per-node retry is a prerequisite for `17`.

> **Status: complete.** Verified by `npm run check:engine` in `server/` (33 checks) plus a
> `curl` pass over the cancel and cycle-validation routes. Three things turned up during
> implementation that weren't in the original task list, and are now folded into `spec/19`:
> the `queue:stats` throttle was dropped (it swallowed the saturation event the indicator
> exists to show), `end` nodes now persist their output (phase 1 computed and discarded the
> workflow's final result), and cancellation reasons are first-wins (a deadline elapsing
> mid-drain no longer relabels a user cancel as a timeout).

## Backend Tasks

### Queue fixes (`queue/InProcessQueue.js`)

- [x] Fix the double `activeCount` decrement: the retry path in `catch` decrements and `return`s, then `finally` decrements again (its guard calls `#settled()`, a stub that always returns `true`). Restructure so exactly one decrement happens per settle — simplest fix is to drop `finally` entirely and decrement explicitly on each of the three exits (success / retry / final failure)
- [x] Delete the `#settled()` stub rather than implementing it
- [x] Make `#processNext()` fill *every* free slot, not one per call (loop while `activeCount < concurrency` and the queue is non-empty)
- [x] Per-job policy: `enqueue(job, { maxAttempts, baseBackoffMs })`, falling back to constructor defaults
- [x] Resolve/reject with attempt count so the engine can record it (`{ result, attempts }` or attach to the error)
- [x] Add a `stats()` method → `{ active, queued, concurrency }`, and emit `stats` on **every** change for the socket layer to forward. Do not throttle: a time window drops the saturation moment, which is the one event the indicator exists to show
- [x] Distinguish permanent from retryable failures: a `PermanentToolFailure` (see `21`'s malformed-JSON case) rejects immediately without consuming attempts; `SimulatedToolFailure` retries as today

### Engine rewrite (`engine/executeRun.js`)

- [x] Replace the sequential `for (const nodeId of order)` loop with a readiness scheduler:
  - [x] `resolved: Map<nodeId, 'success'|'failed'|'skipped'>` and `inFlight: Map<nodeId, Promise>`
  - [x] `readyNodes()` — nodes not resolved/in-flight whose every incoming edge's source is resolved
  - [x] Dispatch **all** ready nodes, then `await Promise.race(inFlight.values())` and re-evaluate; repeat until nothing is ready and nothing is in flight
  - [x] Condition and start/end nodes still resolve synchronously (no queue round-trip)
- [x] Fix skip semantics: mark a node `skipped` only when **every** incoming edge is skipped or from a failed source — replace the current eager `skipped.add(edge.target)` propagation, which breaks any diamond/join graph
- [x] Fix fan-in input shape: one live incoming edge → that output verbatim; several → `{ [sourceNodeId]: output }`; none → `null`. Remove the positional-array branch
- [x] Record `attempts` on each node result and include it in the `node:update` payload
- [x] Persist `handoffTarget` on the node result (the engine already computes it for `16`; it's currently discarded)
- [x] Cancellation:
  - [x] Module-level `Map<runId, { cancelled: boolean, reason: 'user'|'timeout' }>` registry, cleaned up when the run finalizes
  - [x] Check before dispatching each node and after each settle; on cancel, stop dispatching, let in-flight nodes finish, mark unreached nodes `skipped`
  - [x] `cancelReason: 'user'` → run `cancelled`; `'timeout'` → run `failed`
- [x] Fix timeout: express `RUN_TIMEOUT_MS` as an internal cancel instead of `break`. Today it leaves nodes at `pending` and reports the run `success` — a timed-out run must never read as successful
- [x] Deadlock/cycle guard: if nothing is ready and nothing is in flight while unresolved nodes remain, mark them `failed` with a `graph contains a cycle or unreachable nodes` log and fail the run
- [x] Don't abort healthy parallel branches on a sibling's failure — let them finish; the run still ends `failed`

### Cache interaction (`cache/TTLCache.js`, engine)

- [x] Skip the cache read for any tool node with an explicit `failureRate > 0`, so `17`'s "100% failure always fails" criterion holds. Comment it as a deliberate exception — otherwise a cache hit silently bypasses both failure injection and the retry path
- [x] Confirm the cache write still happens inside the node's success path so retried-then-succeeded calls are cached

### Models & routes

- [x] `models/Run.js` — add `'cancelled'` to the status enum, add `cancelReason`, add `attempts` and `handoffTarget` to `nodeResultSchema`
- [x] `POST /api/runs/:id/cancel` → `202`; `409` if the run is already terminal
- [x] Wire the already-written-but-**never-called** `findCycle()` from `engine/topologicalOrder.js` into `PUT /api/workflows/:id`, rejecting cyclic graphs with `400` (cycle prevention currently lives only in the client store)
- [x] `sockets/` — forward queue `stats` as `queue:stats`; emit `run:cancelled`

## Frontend Tasks

- [x] `api/runs.js` — `cancelRun(runId)`
- [x] Run Monitor: "Cancel run" button, enabled only while `pending`/`running`
- [x] `hooks/useRunSocket.js` — handle `run:cancelled` and `queue:stats`
- [x] Run Monitor: queue indicator (`4 running · 3 queued · limit 4`) — without this the parallel engine looks identical to the sequential one in the UI
- [x] Node result cards: show `attempt 3/5` when `attempts > 1`
- [x] `components/ui.jsx` — `cancelled` variant for `StatusBadge`, visually distinct from `failed`

## Verification

- [x] 4-way fan-out of tool nodes shows four nodes `running` at once; `queue:stats` reports `active: 4`
- [x] With `QUEUE_CONCURRENCY=2` the same graph caps at 2 active — the bound is observable, not just configured
- [x] Diamond graph (`Condition → A / B → Join`) runs the join node once instead of skipping it
- [x] A two-input node's result shows an object keyed by source node id
- [x] `failureRate: 1.0` + `maxAttempts: 5` → 5 logged simulated failures, node result `attempts: 5`
- [x] Cancelling mid-run → `cancelled`, unreached nodes `skipped`, completed results intact
- [x] Run exceeding the timeout → `failed` with `cancelReason: 'timeout'`, no node left `pending`
- [x] After a retry-heavy run, `queue:stats.active` returns to 0 and never goes negative
- [x] `curl -X PUT` with a cyclic edge list is rejected `400` (bypasses the client's own guard)
