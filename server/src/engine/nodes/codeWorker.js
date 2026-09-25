/**
 * Runs one Code node invocation (spec/31 §2). Started by code.js as a fresh
 * worker with `env: {}` and a heap cap; the source runs in a vm context that
 * holds only a clone of the input and a capturing console.
 *
 * NOT a security sandbox: node:vm is escapable by design. This contains
 * accidents (a runaway loop, a huge allocation, a stray process.env read), not
 * a hostile author - which is why authoring needs the `code:author` permission.
 */
import { parentPort, workerData } from 'node:worker_threads';
import vm from 'node:vm';

const MAX_LOG_LINES = 100;
const MAX_LOG_CHARS = 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;

const logs = [];
let truncated = false;
const capture = (level) => (...args) => {
  if (logs.length >= MAX_LOG_LINES) {
    if (!truncated) { logs.push('[code] log truncated'); truncated = true; }
    return;
  }
  const line = args.map((a) => (typeof a === 'string' ? a : safeJson(a))).join(' ');
  logs.push(`[code${level === 'log' ? '' : `:${level}`}] ${line.slice(0, MAX_LOG_CHARS)}`);
};

function safeJson(value) {
  try { return JSON.stringify(value); } catch { return String(value); }
}

async function main() {
  const { source, input } = workerData;
  const context = vm.createContext({
    input: input === undefined ? null : structuredClone(input),
    console: { log: capture('log'), info: capture('log'), warn: capture('warn'), error: capture('error') },
  });
  // An async wrapper, so `await` works and a returned Promise is awaited within
  // the same deadline the parent enforces by terminating this worker.
  const fn = vm.runInContext(`(async function (input) {\n${source}\n})`, context, { filename: 'code-node.js' });
  let output = await fn(context.input);
  if (output === undefined) {
    logs.push('[code] returned undefined');
    output = null;
  }
  let serialised;
  try {
    serialised = JSON.stringify(output);
  } catch (err) {
    throw new Error(`Code output is not JSON-serialisable: ${err.message}`);
  }
  if (serialised !== undefined && Buffer.byteLength(serialised) > MAX_OUTPUT_BYTES) {
    throw new Error(`Code output is ${Buffer.byteLength(serialised)} bytes; the limit is ${MAX_OUTPUT_BYTES}`);
  }
  return serialised === undefined ? null : JSON.parse(serialised);
}

main().then(
  (output) => parentPort.postMessage({ ok: true, output, logs }),
  (err) => parentPort.postMessage({ ok: false, error: String(err?.message || err), logs }),
);
