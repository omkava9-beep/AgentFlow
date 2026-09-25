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

/** Jobs enqueued without a workspace (engine check fixtures, system work): uncapped. */
export const SYSTEM_KEY = '__system__';

/** A `Retry-After` from a live API can push the backoff up, but never past this. */
const MAX_RETRY_AFTER_MS = 30_000;

/** A caller's hook must never be able to break the queue's own bookkeeping. */
function callHook(hook, info) {
  if (!hook) return;
  try {
    const out = hook(info);
    if (out && typeof out.catch === 'function') out.catch((err) => console.error('queue hook failed:', err));
  } catch (err) {
    console.error('queue hook failed:', err);
  }
}

let jobCounter = 0;

/**
 * A bounded worker pool that is fair across tenants (spec/33).
 *
 * `concurrency` is the global pool size. Each workspace gets its own FIFO
 * subqueue; free slots are handed out round-robin across the workspaces that
 * have queued work and are below their cap (`capFor(workspaceId)`, injected so
 * the queue never touches MongoDB). A tenant fanning out 50 nodes therefore
 * can't make another tenant's first job wait behind all 50.
 *
 * Unchanged from spec/07 and spec/19: per-job maxAttempts/baseBackoffMs, retry
 * backoff hands the slot back, and the `stats` / `job:*` events.
 */
export class InProcessQueue extends EventEmitter {
  constructor({
    concurrency = 4,
    maxAttempts = 3,
    baseBackoffMs = 500,
    capFor = () => Infinity,
    // Optional metering hooks, so usage accounting lives outside the queue.
    onDispatch = null, // ({ workspaceId, waitedMs })
    onSettled = null, // ({ workspaceId, ok, attempts })
  } = {}) {
    super();
    this.concurrency = concurrency;
    this.maxAttempts = maxAttempts;
    this.baseBackoffMs = baseBackoffMs;
    this.capFor = capFor;
    this.onDispatch = onDispatch;
    this.onSettled = onSettled;

    this.subqueues = new Map(); // key -> Job[] (waiting, FIFO)
    this.activeByKey = new Map(); // key -> running jobs
    this.ring = []; // keys with queued work, in service order
    this.lastServed = null; // the key served most recently (it sits at the back of the ring)
    this.activeCount = 0;
    this.lastReported = new Map(); // workspaceId -> last reported stats key
  }

  /**
   * Resolves `{ result, attempts, queuedMs }`. Rejects with the last error,
   * carrying `.attempts` (and `.queuedMs`) for the same reason.
   *
   * Job hooks, all optional: `onWait({ reason: 'cap' | 'pool' })` fires once if
   * the job can't start straight away; `onStart({ attempt, queuedMs })` on every
   * dispatch; `onRetry(info)` before each backoff.
   */
  enqueue(job, { maxAttempts, baseBackoffMs, meta = {} } = {}) {
    const id = ++jobCounter;
    const workspaceId = meta.workspaceId ? String(meta.workspaceId) : null;
    return new Promise((resolve, reject) => {
      const item = {
        id,
        job,
        attempt: 0,
        resolve,
        reject,
        maxAttempts: normalizeAttempts(maxAttempts, this.maxAttempts),
        baseBackoffMs: baseBackoffMs ?? this.baseBackoffMs,
        workspaceId,
        key: workspaceId || SYSTEM_KEY,
        enqueuedAt: Date.now(),
        waitingSince: Date.now(),
        queuedMs: null,
        started: false,
      };
      this.#push(item);
      this.#fill();
      if (!item.started) item.job.onWait?.({ reason: this.#waitReason(item.key) });
    });
  }

  /** Global view: the engine check and the pool-level indicator use this. */
  stats() {
    return { active: this.activeCount, queued: this.#queuedTotal(), concurrency: this.concurrency };
  }

  /**
   * One tenant's view of the pool (spec/24, spec/33): its own running and waiting
   * jobs, its cap, and one shared bit - whether the pool itself is full - which
   * tells "you're at your plan limit" apart from "the server is busy" without
   * revealing any other tenant's counts.
   */
  statsFor(workspaceId) {
    const key = String(workspaceId);
    return {
      active: this.activeByKey.get(key) || 0,
      queued: this.subqueues.get(key)?.length || 0,
      cap: this.#capOf(key),
      concurrency: this.concurrency,
      poolSaturated: this.activeCount >= this.concurrency,
    };
  }

  /** A plan changed: a raised cap may let queued jobs start right now. */
  capsChanged(workspaceId) {
    if (workspaceId) this.lastReported.delete(String(workspaceId));
    this.#fill();
  }

  // ------------------------------------------------------------------ internals

  #capOf(key) {
    if (key === SYSTEM_KEY) return this.concurrency;
    const cap = Number(this.capFor(key));
    if (!Number.isFinite(cap)) return this.concurrency;
    return Math.max(1, Math.min(Math.floor(cap), this.concurrency));
  }

  #queuedTotal() {
    let n = 0;
    for (const items of this.subqueues.values()) n += items.length;
    return n;
  }

  #waitReason(key) {
    return (this.activeByKey.get(key) || 0) >= this.#capOf(key) ? 'cap' : 'pool';
  }

  #push(item, { front = false } = {}) {
    let items = this.subqueues.get(item.key);
    if (!items) {
      items = [];
      this.subqueues.set(item.key, items);
    }
    if (front) items.unshift(item);
    else items.push(item);
    if (!this.ring.includes(item.key)) {
      // A workspace joining the ring goes ahead of the one served last (which
      // sits at the back), so newcomers get the next free slot instead of
      // waiting out another turn of whoever already had work queued.
      const last = this.ring.length - 1;
      if (last >= 0 && this.ring[last] === this.lastServed) this.ring.splice(last, 0, item.key);
      else this.ring.push(item.key);
    }
  }

  /**
   * The next job to dispatch. The ring rotates: the front workspace is served
   * (if it's below its cap) and moves to the back while it still has work; a
   * capped one just moves to the back. Null when a full pass finds nobody
   * eligible.
   */
  #next() {
    let checked = 0;
    while (checked < this.ring.length) {
      const key = this.ring[0];
      const items = this.subqueues.get(key);
      if (!items?.length) {
        // Drained while waiting its turn; drop it (the ring shrank, so no checked++).
        this.ring.shift();
        this.subqueues.delete(key);
        if (this.lastServed === key) this.lastServed = null;
        continue;
      }
      if ((this.activeByKey.get(key) || 0) >= this.#capOf(key)) {
        this.ring.push(this.ring.shift());
        checked += 1;
        continue;
      }
      const item = items.shift();
      this.ring.shift();
      if (items.length) {
        this.ring.push(key);
        this.lastServed = key;
      } else {
        // Drained, but still the one served last: if it re-queues work before
        // anyone else is served, a newcomer should still go ahead of it.
        this.subqueues.delete(key);
        this.lastServed = key;
      }
      return item;
    }
    return null;
  }

  /** Starts jobs until every free slot is taken, or nobody eligible is waiting. */
  #fill() {
    while (this.activeCount < this.concurrency) {
      const item = this.#next();
      if (!item) break;
      this.#dispatch(item);
    }
    this.#emitStats();
  }

  #dispatch(item) {
    this.activeCount += 1;
    this.activeByKey.set(item.key, (this.activeByKey.get(item.key) || 0) + 1);
    const now = Date.now();
    const waitedMs = now - item.waitingSince;
    // queuedMs is the wait before the FIRST start - what the node detail shows.
    if (item.queuedMs === null) item.queuedMs = now - item.enqueuedAt;
    item.started = true;
    this.onDispatch?.({ workspaceId: item.workspaceId, waitedMs });
    this.#run(item);
  }

  #release(item) {
    this.activeCount -= 1;
    const next = (this.activeByKey.get(item.key) || 0) - 1;
    if (next > 0) this.activeByKey.set(item.key, next);
    else this.activeByKey.delete(item.key);
    this.#fill();
  }

  #emitStats() {
    // Deliberately unthrottled. A time-based throttle drops exactly the event
    // worth seeing - the instant the pool saturates - and at this scale there is
    // nothing to protect against.
    this.emit('stats', this.stats());

    // Per workspace, and only for workspaces whose own numbers moved (spec/24).
    const touched = new Set([...this.activeByKey.keys(), ...this.subqueues.keys(), ...this.lastReported.keys()]);
    touched.delete(SYSTEM_KEY);
    for (const workspaceId of touched) {
      const stats = this.statsFor(workspaceId);
      const key = `${stats.active}:${stats.queued}:${stats.cap}:${stats.poolSaturated}`;
      if (this.lastReported.get(workspaceId) === key) continue;
      this.emit('workspace-stats', { workspaceId, ...stats });
      // Forget idle workspaces once their final idle state has been reported.
      if (stats.active === 0 && stats.queued === 0) this.lastReported.delete(workspaceId);
      else this.lastReported.set(workspaceId, key);
    }
  }

  async #run(item) {
    item.attempt += 1;
    this.emit('job:started', { id: item.id, attempt: item.attempt });
    item.job.onStart?.({ attempt: item.attempt, queuedMs: item.queuedMs });
    const attemptStartedAt = new Date();
    callHook(item.job.onAttemptStart, { attempt: item.attempt, startedAt: attemptStartedAt });
    // spec/35 §6: every attempt is reported with its timing and outcome, so the
    // caller can draw the retry/backoff timeline rather than guess it from logs.
    const endAttempt = (fields) => {
      const finishedAt = new Date();
      callHook(item.job.onAttemptEnd, {
        attempt: item.attempt,
        startedAt: attemptStartedAt,
        finishedAt,
        durationMs: finishedAt - attemptStartedAt,
        ...fields,
      });
    };

    let result;
    try {
      result = await item.job.run(item.job.payload);
    } catch (err) {
      if (!isPermanent(err) && item.attempt < item.maxAttempts) {
        let backoff = item.baseBackoffMs * 2 ** (item.attempt - 1);
        // A live API's Retry-After (spec/26) can lengthen the wait, capped at 30 s.
        if (Number.isFinite(err?.retryAfterMs) && err.retryAfterMs > 0) {
          backoff = Math.min(Math.max(backoff, err.retryAfterMs), MAX_RETRY_AFTER_MS);
        }
        const info = {
          id: item.id,
          attempt: item.attempt,
          maxAttempts: item.maxAttempts,
          error: err.message,
          backoff,
        };
        endAttempt({ outcome: 'failed', error: err.message, backoffMs: backoff });
        this.emit('job:retrying', info);
        // Per-job hook: lets the caller attribute a retry to the node that
        // caused it, which the global event stream can't do (it only has a job id).
        item.job.onRetry?.(info);
        // Hand the slot back - both the pool slot and the workspace's cap - while
        // the backoff runs, then requeue at the front of the workspace's own
        // subqueue so a retrying job doesn't starve behind newer work.
        this.#release(item);
        await delay(backoff);
        item.waitingSince = Date.now();
        this.#push(item, { front: true });
        this.#fill();
        return;
      }
      endAttempt({ outcome: 'failed', error: err.message, backoffMs: null });
      this.emit('job:failed', { id: item.id, attempt: item.attempt, error: err.message });
      err.attempts = item.attempt;
      err.queuedMs = item.queuedMs;
      this.onSettled?.({ workspaceId: item.workspaceId, ok: false, attempts: item.attempt });
      item.reject(err);
      this.#release(item);
      return;
    }

    endAttempt({ outcome: 'success', error: null, backoffMs: null, result });
    this.emit('job:succeeded', { id: item.id, attempt: item.attempt });
    this.onSettled?.({ workspaceId: item.workspaceId, ok: true, attempts: item.attempt });
    item.resolve({ result, attempts: item.attempt, queuedMs: item.queuedMs });
    this.#release(item);
  }
}
