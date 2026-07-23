import { EventEmitter } from 'node:events';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let jobCounter = 0;

export class InProcessQueue extends EventEmitter {
  constructor({ concurrency = 4, maxAttempts = 3 } = {}) {
    super();
    this.concurrency = concurrency;
    this.maxAttempts = maxAttempts;
    this.queue = [];
    this.activeCount = 0;
  }

  enqueue(job) {
    const id = ++jobCounter;
    return new Promise((resolve, reject) => {
      this.queue.push({ id, job, attempt: 0, resolve, reject });
      this.#processNext();
    });
  }

  #processNext() {
    if (this.activeCount >= this.concurrency) return;
    const item = this.queue.shift();
    if (!item) return;

    this.activeCount += 1;
    this.#run(item);
  }

  async #run(item) {
    item.attempt += 1;
    this.emit('job:started', { id: item.id, attempt: item.attempt });
    try {
      const result = await item.job.run(item.job.payload);
      this.emit('job:succeeded', { id: item.id, attempt: item.attempt, result });
      item.resolve(result);
    } catch (err) {
      if (item.attempt < this.maxAttempts) {
        const backoff = 500 * 2 ** item.attempt;
        this.emit('job:retrying', { id: item.id, attempt: item.attempt, error: err.message, backoff });
        await delay(backoff);
        this.activeCount -= 1;
        this.queue.unshift(item);
        this.#processNext();
        return;
      }
      this.emit('job:failed', { id: item.id, attempt: item.attempt, error: err.message });
      item.reject(err);
    } finally {
      if (item.attempt >= this.maxAttempts || this.#settled(item)) {
        this.activeCount -= 1;
        this.#processNext();
      }
    }
  }

  #settled() {
    return true;
  }
}
