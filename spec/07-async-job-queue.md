# Spec: Async Job Queue

**Status:** MVP
**Milestone:** M2
**Depends on:** —

## Summary

A small in-process job queue standing in for a real broker (BullMQ/Redis, SQS, etc.). Gives the execution engine (`06`) bounded concurrency, retry-with-backoff, and a place to observe job lifecycle — the core "async job processing" learning objective of the project.

## Goals

- `enqueue(job: { type, payload, run(payload) })` — accepts a unit of work.
- Bounded concurrency (e.g. max 4 jobs running at once, configurable) — extra jobs wait in an in-memory FIFO.
- Automatic retry with exponential backoff on failure, up to a configurable max attempt count (e.g. 3).
- Emits lifecycle events (`job:started`, `job:succeeded`, `job:failed`, `job:retrying`) that the execution engine (`06`) and monitoring (`09`) subscribe to.

## Non-goals

- Persistence of queued jobs across a server restart (in-memory only — a restart loses in-flight jobs, which is acceptable for this scope).
- Priority queues, delayed jobs, or cron-like scheduling (scheduling is handled separately in `12`, at the trigger level, not inside this queue).
- Cross-process/distributed workers.

## Design

A minimal worker-pool built on Node's event loop:

```
class InProcessQueue extends EventEmitter {
  constructor({ concurrency = 4, maxAttempts = 3 }) { ... }
  enqueue(job) { ... }   // pushes to internal array, kicks off processing
  #processNext() { ... } // pulls next job if under concurrency limit
}
```

- Backoff schedule: e.g. `attempt => 500 * 2 ** attempt` ms between retries.
- A job's `run(payload)` is expected to throw/reject on failure; the queue catches and decides retry vs. give up.

## Edge Cases & Error Handling

- A job that throws a non-retryable error type (if ever needed) — not required for MVP; all failures are retried up to `maxAttempts` uniformly.
- Queue saturation (many jobs enqueued at once) — just queues them; no need for a max-queue-length guard at this scale (single demo user, small workflows).

## Acceptance Criteria

- [ ] Enqueuing more jobs than the concurrency limit results in the excess waiting, not running immediately.
- [ ] A job whose `run()` rejects is retried with increasing delay, up to `maxAttempts`, before being marked failed.
- [ ] `job:*` events fire in the correct order and are observable by a subscriber (used by `06` and `09`).
