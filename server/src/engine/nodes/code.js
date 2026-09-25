import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { env } from '../../config/env.js';
import { PermanentFailure } from '../../queue/errors.js';

const WORKER = fileURLToPath(new URL('./codeWorker.js', import.meta.url));

/**
 * Code is deterministic: the same input fails the same way, so failures are
 * permanent - unless the author explicitly asked for retries.
 */
function failure(node, message) {
  return node.data?.config?.mockOverrides?.maxAttempts ? new Error(message) : new PermanentFailure(message);
}

function runInWorker(node, source, input) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, {
      workerData: { source, input },
      // Empty, so SECRETS_MASTER_KEY / JWT_SECRET / API keys aren't sitting in
      // the worker's process.env.
      env: {},
      resourceLimits: { maxOldGenerationSizeMb: env.codeNodeMemoryMb },
      stdout: true,
      stderr: true,
    });
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      fn(value);
    };
    // terminate() rather than vm's own timeout: it also stops async code and
    // runaway promises, not just synchronous loops.
    const timer = setTimeout(
      () => settle(reject, failure(node, `Code timed out after ${env.codeNodeTimeoutMs}ms`)),
      env.codeNodeTimeoutMs,
    );
    worker.once('message', (msg) => {
      if (msg.ok) settle(resolve, msg);
      else {
        const err = failure(node, `Code threw: ${msg.error}`);
        err.logs = msg.logs;
        settle(reject, err);
      }
    });
    worker.once('error', (err) => {
      const message = err?.code === 'ERR_WORKER_OUT_OF_MEMORY'
        ? `Code exceeded the memory limit (${env.codeNodeMemoryMb} MB)`
        : `Code crashed: ${err?.message || err}`;
      settle(reject, failure(node, message));
    });
    worker.once('exit', (code) => settle(reject, failure(node, `Code worker exited (${code}) without a result`)));
  });
}

export default {
  type: 'code',
  // It burns CPU, so it takes a queue slot like any other leaf work.
  kind: 'work',
  handles: { source: ['default'], error: true },
  // One attempt unless the author opted into retries.
  maxAttempts: (node) => node.data?.config?.mockOverrides?.maxAttempts ?? 1,
  async execute(ctx) {
    if (!env.codeNodeEnabled) throw new PermanentFailure('Code nodes are disabled on this server');
    const source = String(ctx.config?.source || '');
    if (!source.trim()) throw new PermanentFailure('Code node has no source');
    const { output, logs } = await runInWorker(ctx.node, source, ctx.input);
    return { output, logs };
  },
};
