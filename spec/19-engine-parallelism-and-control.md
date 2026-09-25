# Spec: Engine Parallelism & Run Control

**Status:** Phase 2 extension
**Milestone:** M3
**Depends on:** `06-execution-engine.md`, `07-async-job-queue.md`

> **Revised in phase 3:** Error branches count as live edges and `first`-mode merges change readiness ([`31`](31-advanced-nodes.md)); the run deadline counts active time only ([`32`](32-human-in-the-loop.md)); the "resuming or retrying a run" non-goal is lifted ([`35`](35-run-operations.md)).

## Summary

Deepens the execution engine from a strictly sequential topological walk into a readiness-driven scheduler that dispatches independent nodes concurrently, resolves fan-in correctly, supports per-node retry policy, and can be cancelled mid-run.

`06` promised "sequential steps, parallel branches, and conditional branching," and `07` promised a bounded-concurrency worker pool. The phase-1 implementation delivers the first and third but not the second: `executeRun()` iterates the topological order and `await`s each node's queue job before starting the next, so at most one job is ever in flight and `QUEUE_CONCURRENCY` is unobservable. This spec closes that gap and fixes the correctness bugs that the sequential shape was hiding.

## Goals

### 1. Concurrent fan-out

Replace the `for (const nodeId of topologicalOrder(...))` loop with a readiness loop:

- A node is **ready** when every incoming edge is *resolved* — its source node has reached `success`, `failed`, or `skipped`.
- Every ready node is dispatched immediately; the engine then waits on `Promise.race` of the in-flight set and re-evaluates readiness as each settles.
- Actual parallelism is therefore bounded by the queue's `concurrency`, which is the point: with `QUEUE_CONCURRENCY=4` and a four-way fan-out, four tool nodes run at once and a fifth waits for a slot.

`topologicalOrder()` is still useful for validation (it detects cycles by returning fewer ids than nodes) but is no longer the execution driver.

### 2. Correct fan-in / skip semantics

Current behavior marks a node `skipped` as soon as *one* incoming edge is skipped. That is wrong for any diamond graph — the canonical `[Condition] → [A] / [B] → [Join]` shape, which `PRODUCT.md` uses as its own example, wrongly skips the join.

New rule: a node is `skipped` only when **every** incoming edge is skipped or comes from a failed node. If at least one incoming edge is live, the node runs with whatever inputs are available.

A node with no incoming edges and no `start` type is unreachable-by-design and runs as a root — the engine should not silently strand it as `pending`.

### 3. Explicit fan-in input shape

Today a node's input is `outputs.get(source)` for one incoming edge and an unnamed positional array for several — so a condition expression written against `output.tempC` silently breaks when a second edge is added, and array indices shift when a branch is skipped.

New contract:

- Exactly one **live** incoming edge → that source's output verbatim (unchanged from phase 1).
- Multiple live incoming edges → an object keyed by source node id: `{ [sourceNodeId]: output, ... }`. Only live sources appear as keys.
- Zero live incoming edges (root node) → `null`.

An `end` node must also **persist** its resolved input as its own `output`. Phase 1 computed it and threw it away, so a run's final result was never visible anywhere — the one value a viewer most wants from a finished run.

This is a breaking change for any saved workflow relying on the positional array. Acceptable: the array shape was never documented in `06` and is unlikely to be depended on.

### 4. Per-node retry policy

`07`'s retry is currently one global `QUEUE_MAX_ATTEMPTS` for every job. Let a node override it, which is what makes `17-failure-injection.md` demonstrable ("this node retries 5 times, that one gives up immediately").

- `queue.enqueue()` accepts per-job `{ maxAttempts, baseBackoffMs }`, falling back to the queue's constructor defaults.
- Node config gains optional `mockOverrides.maxAttempts`.
- Attempt count is recorded on the node result and streamed, so the UI can show "succeeded on attempt 3 of 5."

### 5. Run cancellation

A long or deliberately-failing run needs a stop button — currently the only way to end one is to wait it out, and the 409 "run already in progress" guard in `createRun` means a stuck run blocks the workflow entirely.

- Cooperative cancellation: the engine checks a cancellation flag before dispatching each node and after each node settles. Nodes already in flight are allowed to finish (mock handlers are short); their results are kept.
- On cancel, every unreached node becomes `skipped` and the run becomes `cancelled`.

### 6. Correct timeout handling

`RUN_TIMEOUT_MS` currently `break`s out of the loop, which leaves unreached nodes at `pending` forever and — because `runFailed` is still `false` — reports the run as **`success`**. A timed-out run must not read as a successful one.

Timeout is re-expressed as an internal cancellation with `cancelReason: 'timeout'`, producing `status: 'failed'` (a timeout is a failure, not a user decision) and `skipped` for unreached nodes.

The deadline is env-configurable (`RUN_TIMEOUT_MS`) and overridable per run. A hardcoded constant is neither demoable nor testable, and a purely process-global one can't be shortened for one run without starving every other run sharing the process.

### 7. Queue bug fixes

`InProcessQueue` has two defects that only stay invisible because concurrency is never exercised:

- **Double decrement of `activeCount` on retry.** The retry path in `catch` decrements `activeCount` and returns — but `finally` then runs and decrements again, because its guard calls `#settled()`, which is a stub that unconditionally returns `true`. Each retry therefore permanently lowers the effective in-flight count, and `activeCount` can go negative, defeating the concurrency bound entirely. Once fan-out lands this becomes an unbounded-parallelism bug.
- **`#processNext()` starts at most one job per call.** After a job settles only one replacement starts, so the pool cannot refill more than one slot at a time. It should fill every free slot.

Delete the `#settled()` stub rather than implementing it — settled-ness is already unambiguous from which branch ran.

### 8. Server-side graph validation

`findCycle()` exists in `engine/topologicalOrder.js` and is **never called** — cycle prevention lives only in the client store's `wouldCreateCycle`. So the API accepts a cyclic graph from any non-browser caller, and (per `15-workflow-templates.md`) a cloned template could reintroduce one. Wire `findCycle()` into `PUT /api/workflows/:id`, rejecting with `400`.

## Non-goals

- Distributed or persistent queueing. The queue stays in-process and loses its backlog on restart, per `CLAUDE.md`.
- True preemption — killing a mock handler mid-`setTimeout`. Cancellation is cooperative only.
- Speculative execution of both condition branches. A condition still resolves before its successors are considered ready.
- Per-node timeouts. One run-level deadline is enough.
- Resuming or retrying a whole run from the point of failure — a new run is started instead.

## Data Model

**Run**
```
status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled'   // + 'cancelled'
cancelReason: 'user' | 'timeout' | null                              // new
```

**Run.nodeResults[]**
```
attempts: number         // new, defaults to 1
handoffTarget: string     // new — persists what 16's engine logic already computes
```

**Workflow.nodes[].data.config.mockOverrides**
```
{ failureRate?: number, latencyMs?: [number, number], maxAttempts?: number }   // maxAttempts is new
```

## API

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/runs/:id/cancel` | — | `202 { status: 'cancelled' }` |

- Cancelling a run that is already `success`/`failed`/`cancelled` → `409` with a clear message, not a silent no-op.
- `PUT /api/workflows/:id` rejects a cyclic `edges` payload with `400 { error: 'Workflow graph contains a cycle' }`.

## Socket Events

Extends `09-realtime-monitoring.md`'s namespaced convention:

| Event | Payload | When |
|---|---|---|
| `node:update` | existing fields + `attempts` | unchanged cadence; `attempts` now included |
| `run:cancelled` | `{ runId, cancelReason, finishedAt }` | run cancelled by user or timeout |
| `queue:stats` | `{ active, queued, concurrency }` | on every change (see note) |

`queue:stats` is emitted on every change rather than throttled. A time-based throttle drops precisely the event worth seeing — the instant the pool saturates — and at this scale (tens of nodes per run, a single viewer) there is no flooding to protect against.

`queue:stats` is what makes bounded concurrency *visible* — without it, the difference between the sequential and parallel engine is invisible in the UI, which would waste the whole change from a demo standpoint.

## UI Behavior

- **Run Monitor** gains a "Cancel run" button, enabled only while `status` is `pending`/`running`.
- **Run Monitor** gains a small queue indicator fed by `queue:stats` — e.g. `4 running · 3 queued · limit 4` — so a viewer can watch the pool saturate and drain during a fan-out.
- Node results show `attempts` when greater than 1 (e.g. a `✓ attempt 3/5` marker), making retry/backoff legible without reading logs.
- `cancelled` gets its own `StatusBadge` variant, visually distinct from `failed` — a cancelled run is not a broken one.
- Concurrently-running nodes all render in the `running` state at once on the graph view, which is the visible payoff of goal 1.

## Edge Cases & Error Handling

- **All incoming edges skipped** → node `skipped`, propagates onward. This is the intended condition-branch behavior and must not be confused with the fan-in case in goal 2.
- **Cycle in a stored workflow** (saved before validation existed) → nodes in the cycle are never ready. The engine must detect that the in-flight set is empty while unresolved nodes remain, mark them `failed` with a `graph contains a cycle or unreachable nodes` log, and fail the run — never hang or report success.
- **A node fails while siblings are still in flight** → siblings are allowed to finish; the run still ends `failed`. Do not abort healthy parallel branches on the first failure.
- **Cancel arriving between dispatch and settle** → the in-flight node keeps its real result; only unreached nodes become `skipped`.
- **Timeout elapsing during a user-requested cancel** → first reason wins. In-flight nodes can still be draining when the deadline passes, and a run the user cancelled must stay `cancelled`, not silently become `failed`/`timeout` because that drain took a moment.
- **`maxAttempts: 0` or negative** → treated as 1 (a single attempt, no retries), not as "never run."
- **Cache short-circuits retry.** `executeAgentOrTool()` checks `toolCache` *before* enqueuing, so a cache hit never exercises the retry path and never applies the node's `failureRate`. Two tool nodes sharing a `toolType` + input therefore share cached results even when one has a 100% failure rate configured. Resolution: skip the cache read for any node with an explicit `failureRate > 0`, so `17`'s acceptance criteria hold. Document the choice in the cache module — it is a deliberate exception, not an oversight.

## Acceptance Criteria

- [ ] A workflow with a 4-way fan-out of tool nodes shows all four `running` simultaneously in the Run Monitor, and `queue:stats` reports `active: 4`.
- [ ] With `QUEUE_CONCURRENCY=2`, the same workflow shows at most 2 active and the rest queued — the bound is observable, not just configured.
- [ ] A diamond graph (`Condition → A / B → Join`) runs the join node exactly once, on the branch that was taken, instead of skipping it.
- [ ] A node with two live inputs receives `{ [sourceId]: output }` keyed by source node id, verifiable in the node result panel.
- [ ] A tool node with `failureRate: 1.0` and `maxAttempts: 5` logs 5 simulated-failure attempts before the node fails, and the node result reports `attempts: 5`.
- [ ] Cancelling a running run marks it `cancelled`, marks unreached nodes `skipped`, and leaves already-completed node results intact.
- [ ] A run that exceeds `RUN_TIMEOUT_MS` ends as `failed` with `cancelReason: 'timeout'` and no node left at `pending` — never as `success`.
- [ ] Retrying jobs no longer corrupt `activeCount`: after a run with many simulated failures, `queue:stats.active` returns to 0 and is never negative.
- [ ] `PUT /api/workflows/:id` with a cyclic edge list is rejected with `400`, verifiable with `curl` (bypassing the client's own cycle guard).
- [ ] An `end` node's result carries the workflow's final output.
- [ ] A user cancel followed by the deadline elapsing still reports `cancelled`, not `failed`.

`npm run check:engine` (in `server/`) exercises these against a throwaway database; run it with `QUEUE_CONCURRENCY=2 RUN_TIMEOUT_MS=300` to cover the bound and deadline cases too.
