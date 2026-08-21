# Plan: Async Job Queue

**Spec:** [`spec/07-async-job-queue.md`](../spec/07-async-job-queue.md)
**Depends on:** `00-project-setup`

## Backend Tasks

- [ ] `queue/InProcessQueue.js` — `EventEmitter`-based class:
  - [ ] `constructor({ concurrency = 4, maxAttempts = 3 })`
  - [ ] `enqueue(job)` — pushes `{ type, payload, run(payload) }` to an internal FIFO array
  - [ ] Internal `#processNext()` — pulls next job while under the concurrency limit, invokes `job.run(payload)`
  - [ ] Retry logic: on rejection, retry with backoff (`attempt => 500 * 2 ** attempt`) up to `maxAttempts`, else mark failed
  - [ ] Emit `job:started`, `job:succeeded`, `job:failed`, `job:retrying` events with enough payload (job id, attempt number, error) for subscribers
- [ ] Export a singleton instance (`queue/index.js`) used by the execution engine (`06`)
- [ ] Quick manual/scratch test: enqueue more jobs than `concurrency`, confirm excess wait; enqueue a job that always rejects, confirm retry/backoff timing and eventual failure

## Frontend Tasks

None — purely a backend primitive; visibility into it happens via `09-realtime-monitoring`.

## Verification

- [ ] Enqueuing 10 jobs with `concurrency: 4` shows exactly 4 running at once, rest waiting
- [ ] A job that always fails is retried the configured number of times with increasing delay, then marked failed
- [ ] `job:*` events fire in the correct order and are observable by a test subscriber
