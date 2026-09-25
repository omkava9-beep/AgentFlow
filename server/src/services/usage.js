import mongoose from 'mongoose';
import UsageCounter from '../models/UsageCounter.js';

/**
 * Usage metering (spec/33 §6). Hot-path counters (node executions, integration
 * calls, cache hits, queue wait...) accumulate in memory and are flushed every
 * 5 s as one bulkWrite of `$inc`s. A crash can lose up to 5 s of counts, which
 * is fine for a usage chart. `runs` is NOT counted here - it gates the quota,
 * so services/quota.js increments it synchronously.
 *
 * The accumulator is a process singleton, like the cache and the queue.
 */

const FLUSH_INTERVAL_MS = 5000;

/** Every counter path the UsageCounter schema has, so a typo'd delta is dropped, not stored. */
const COUNTER_PATHS = [
  'runs', 'nodeExecutions', 'integrationCalls.live', 'integrationCalls.sandbox', 'mcpCalls',
  'agentCalls.mock', 'agentCalls.llm', 'cacheHits', 'cacheMisses', 'queueWaitMsTotal',
];
const ALLOWED = new Set(COUNTER_PATHS);

export const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);

/** The next UTC midnight - when today's quota resets. */
export function nextUtcMidnight(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
}

let pending = new Map(); // `${workspaceId}|${day}` -> { path: n }

/** Flattens `{ integrationCalls: { live: 1 } }` and accepts `'integrationCalls.live'` as-is. */
function flatten(deltas, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(deltas || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') flatten(value, path, out);
    else if (Number.isFinite(Number(value)) && Number(value) !== 0) out[path] = (out[path] || 0) + Number(value);
  }
  return out;
}

/**
 * `recordUsage(workspaceId, { nodeExecutions: 1 })`, `{ integrationCalls: { live: 1 } }`,
 * `{ 'agentCalls.llm': 1 }`... No-op without a workspace (engine check fixtures).
 */
export function recordUsage(workspaceId, deltas) {
  if (!workspaceId) return;
  const key = `${workspaceId}|${utcDay()}`;
  const bucket = pending.get(key) || {};
  for (const [path, n] of Object.entries(flatten(deltas))) {
    if (!ALLOWED.has(path)) continue;
    bucket[path] = (bucket[path] || 0) + n;
  }
  if (Object.keys(bucket).length) pending.set(key, bucket);
}

function merge(into, from) {
  for (const [key, bucket] of from) {
    const target = into.get(key) || {};
    for (const [path, n] of Object.entries(bucket)) target[path] = (target[path] || 0) + n;
    into.set(key, target);
  }
}

/**
 * Writes everything accumulated so far. The batch is swapped out first, so new
 * counts recorded during the write land in a fresh map; on failure the batch is
 * merged back and retried next tick. Never double-counts, never drops on error.
 */
export async function flushUsage() {
  if (!pending.size || mongoose.connection.readyState !== 1) return 0;
  const batch = pending;
  pending = new Map();
  const ops = [...batch].map(([key, $inc]) => {
    const [workspaceId, day] = key.split('|');
    return { updateOne: { filter: { workspaceId, day }, update: { $inc }, upsert: true } };
  });
  try {
    await UsageCounter.bulkWrite(ops, { ordered: false });
    return ops.length;
  } catch (err) {
    merge(pending, batch);
    console.error('[usage] flush failed, will retry:', err.message);
    return 0;
  }
}

const timer = setInterval(() => { flushUsage(); }, FLUSH_INTERVAL_MS);
timer.unref?.();

const EMPTY = () => ({
  runs: 0, nodeExecutions: 0, integrationCalls: { live: 0, sandbox: 0 }, mcpCalls: 0,
  agentCalls: { mock: 0, llm: 0 }, cacheHits: 0, cacheMisses: 0, queueWaitMsTotal: 0,
});

function addPath(target, path, n) {
  const [head, tail] = path.split('.');
  if (tail) target[head][tail] += n;
  else target[head] += n;
}

/**
 * Daily series for the Usage page, oldest first, with every day present (zeros
 * for quiet days) and today's not-yet-flushed counts folded in so the page
 * doesn't lag the queue indicator by up to 5 s.
 */
export async function getUsage(workspaceId, { days = 30 } = {}) {
  const span = Math.min(Math.max(Math.floor(Number(days) || 30), 1), 90);
  const now = new Date();
  const dayList = Array.from({ length: span }, (_, i) =>
    utcDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (span - 1 - i)))));

  const docs = await UsageCounter.find({ workspaceId, day: { $gte: dayList[0] } }).lean();
  const byDay = new Map(dayList.map((day) => [day, { day, ...EMPTY() }]));
  for (const doc of docs) {
    const row = byDay.get(doc.day);
    if (!row) continue;
    for (const path of COUNTER_PATHS) {
      const [head, tail] = path.split('.');
      const value = tail ? doc[head]?.[tail] : doc[head];
      if (value) addPath(row, path, value);
    }
  }
  for (const [key, bucket] of pending) {
    const [ws, day] = key.split('|');
    if (ws !== String(workspaceId) || !byDay.has(day)) continue;
    for (const [path, n] of Object.entries(bucket)) addPath(byDay.get(day), path, n);
  }
  return [...byDay.values()];
}
