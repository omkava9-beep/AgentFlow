import { EventEmitter } from 'node:events';
import { isPermanent } from './errors.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `undefined` inherits the queue default; anything below 1 means "one attempt, no retries". */
function normalizeAttempts(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

let jobCounter = 0;

export class InProcessQueue extends EventEmitter {
  constructor({ concurrency = 4, maxAttempts = 3, baseBackoffMs = 500 } = {}) {
    super();
    this.concurrency = concurrency;
    this.maxAttempts = maxAttempts;
    this.baseBackoffMs = baseBackoffMs;
    this.queue = [];
    this.activeCount = 0;
  }

  /**
   * Resolves `{ result, attempts }` so callers can report how many tries a job took.
   * Rejects with the last error, carrying `.attempts` for the same reason.
   */
  enqueue(job, { maxAttempts, baseBackoffMs } = {}) {
    const id = ++jobCounter;
    return new Promise((resolve, reject) => {
      this.queue.push({
        id,
        job,
        attempt: 0,
        resolve,
        reject,
        maxAttempts: normalizeAttempts(maxAttempts, this.maxAttempts),
        baseBackoffMs: baseBackoffMs ?? this.baseBackoffMs,
      });
      this.#fill();
    });
  }

  stats() {
    return { active: this.activeCount, queued: this.queue.length, concurrency: this.concurrency };
  }

  #emitStats() {
    // Deliberately unthrottled. A time-based throttle drops exactly the event
    // worth seeing - the instant the pool saturates - and at this scale (tens of
    // nodes per run, one viewer) there is nothing to protect against.
    this.emit('stats', this.stats());
  }

  /** Starts jobs until every free slot is taken (not just one per call). */
  #fill() {
    while (this.activeCount < this.concurrency && this.queue.length) {
      const item = this.queue.shift();
      this.activeCount += 1;
      this.#run(item);
    }
    this.#emitStats();
  }

  #release() {
    this.activeCount -= 1;
    this.#fill();
  }

  async #run(item) {
    item.attempt += 1;
    this.emit('job:started', { id: item.id, attempt: item.attempt });

    let result;
    try {
      result = await item.job.run(item.job.payload);
    } catch (err) {
      if (!isPermanent(err) && item.attempt < item.maxAttempts) {
        const backoff = item.baseBackoffMs * 2 ** (item.attempt - 1);
        const info = {
          id: item.id,
          attempt: item.attempt,
          maxAttempts: item.maxAttempts,
          error: err.message,
          backoff,
        };
        this.emit('job:retrying', info);
        // Per-job hook: lets the caller attribute a retry to the node that
        // caused it, which the global event stream can't do (it only has a job id).
        item.job.onRetry?.(info);
        // Hand the slot back while we wait out the backoff, then requeue at the
        // front so a retrying job doesn't starve behind newly-arrived work.
        this.#release();
        await delay(backoff);
        this.queue.unshift(item);
        this.#fill();
        return;
      }
      this.emit('job:failed', { id: item.id, attempt: item.attempt, error: err.message });
      err.attempts = item.attempt;
      item.reject(err);
      this.#release();
      return;
    }

    this.emit('job:succeeded', { id: item.id, attempt: item.attempt });
    item.resolve({ result, attempts: item.attempt });
    this.#release();
  }
}
