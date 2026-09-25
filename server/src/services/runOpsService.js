import mongoose from 'mongoose';
import Run from '../models/Run.js';
import { HttpError } from '../middleware/errorHandler.js';
import { scopedFilter, isValidObjectId } from '../tenancy/scoped.js';
import { edgeKey, fromStateKey } from '../engine/executeRun.js';
import { TRIGGERS } from './runService.js';

/**
 * spec/35: the things people do with runs after starting them - retry
 * planning, workspace-wide search, the shared run detail and per-node stats.
 * Controllers stay thin; the rules live here.
 */

export const RUN_STATUSES = ['pending', 'running', 'waiting', 'success', 'failed', 'cancelled'];
const FAIL_REASONS = ['nodes_failed', 'timeout', 'interrupted'];
const TERMINAL = ['success', 'failed', 'cancelled'];

const plainOutputs = (outputs) => (outputs instanceof Map ? Object.fromEntries(outputs) : (outputs || {}));

// ------------------------------------------------------------------ retry

/**
 * Which nodes a retry-from-failed re-executes and which it reuses (spec/35 §2).
 *
 * The retry set R is `fromNodeIds`, or by default every node that failed
 * without being handled, plus the "frontier" - nodes a cancel or timeout cut
 * off before they could run (they had a live input but never finished). If
 * that is empty, the handled failures, so a success-with-handled-failures run
 * can still be retried. Everything downstream of R re-executes too; the rest is
 * reused as-is.
 *
 * Returns `{ retryable, reason?, retrySet, reexecuted, reused }`.
 */
export function planRetry(run, graph, fromNodeIds = null) {
  const nodes = graph?.nodes || [];
  const edges = (graph?.edges || []).filter((e) => e.source && e.target);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const results = new Map((run.nodeResults || []).map((r) => [r.nodeId, r]));
  const handledFailures = [...results.values()].filter((r) => r.status === 'failed' && r.handled).map((r) => r.nodeId);

  if (run.parentRunId) return { retryable: false, reason: "Child runs can't be retried on their own - retry the root run" };
  if (!TERMINAL.includes(run.status)) return { retryable: false, reason: 'Only a finished run can be retried' };
  if (run.status === 'success' && !handledFailures.length) {
    return { retryable: false, reason: 'This run succeeded - there is nothing to retry' };
  }

  const pruned = new Set(run.engineState?.pruned || []);
  const incomingOf = (id) => edges.filter((e) => e.target === id && nodeIds.has(e.source));
  // Whether this edge carried a value in the ORIGINAL run.
  const wasLive = (edge) => {
    if (pruned.has(edgeKey(edge))) return false;
    const src = results.get(edge.source);
    if (edge.sourceHandle === 'error') return src?.status === 'failed' && Boolean(src.handled);
    return src?.status === 'success';
  };

  let retrySet;
  if (fromNodeIds?.length) {
    const unknown = fromNodeIds.filter((id) => !nodeIds.has(id));
    if (unknown.length) throw new HttpError(400, `Unknown node id(s) in fromNodeIds: ${unknown.join(', ')}`);
    retrySet = [...new Set(fromNodeIds)];
  } else {
    const failed = [...results.values()].filter((r) => r.status === 'failed' && !r.handled).map((r) => r.nodeId);
    const frontier = nodes
      .filter((n) => !['success', 'failed'].includes(results.get(n.id)?.status))
      .filter((n) => {
        const incoming = incomingOf(n.id);
        return incoming.length === 0 || incoming.some(wasLive);
      })
      .map((n) => n.id);
    retrySet = [...new Set([...failed, ...frontier])].filter((id) => nodeIds.has(id));
    if (!retrySet.length) retrySet = handledFailures.filter((id) => nodeIds.has(id));
  }
  if (!retrySet.length) return { retryable: false, reason: 'No failed nodes to retry' };

  // R ∪ descendants(R), following every edge of the pinned graph (error edges too).
  const reexecute = new Set(retrySet);
  const stack = [...retrySet];
  while (stack.length) {
    const id = stack.pop();
    for (const edge of edges) {
      if (edge.source === id && nodeIds.has(edge.target) && !reexecute.has(edge.target)) {
        reexecute.add(edge.target);
        stack.push(edge.target);
      }
    }
  }
  const order = nodes.map((n) => n.id);
  return {
    retryable: true,
    retrySet,
    reexecuted: order.filter((id) => reexecute.has(id)),
    reused: order.filter((id) => !reexecute.has(id)),
  };
}

// Result fields a reused node keeps from the original run.
const REUSED_FIELDS = [
  'nodeId', 'status', 'output', 'logs', 'cached', 'attempts', 'handoffTarget', 'integration', 'action', 'mode',
  'startedAt', 'finishedAt', 'durationMs', 'handled', 'progress', 'childRunIds', 'queuedMs', 'attemptsLog',
  'approval', 'toolCalls', 'agentSteps',
];

/**
 * The engine seed for a retry (spec/35 §2 step 4): reused nodes' results,
 * their downstream outputs, and only the pruned edges whose source is reused -
 * upstream routing stands, the retried region starts fresh.
 */
export function buildRetrySeed(run, graph, reusedIds) {
  const reused = new Set(reusedIds);
  const results = (run.nodeResults || [])
    .filter((r) => reused.has(r.nodeId))
    .map((r) => {
      const src = r.toObject ? r.toObject() : r;
      const copy = {};
      for (const key of REUSED_FIELDS) if (src[key] !== undefined) copy[key] = src[key];
      return copy;
    });

  const stored = plainOutputs(run.engineState?.outputs);
  const outputs = {};
  for (const [key, value] of Object.entries(stored)) {
    const nodeId = fromStateKey(key);
    if (reused.has(nodeId)) outputs[nodeId] = value;
  }
  // A success result with no engineState entry (e.g. its output was never
  // mirrored) falls back to the persisted output.
  for (const r of results) {
    if (!(r.nodeId in outputs) && r.status === 'success') outputs[r.nodeId] = r.output ?? null;
  }

  const sourceByKey = new Map((graph.edges || []).map((e) => [edgeKey(e), e.source]));
  const pruned = (run.engineState?.pruned || []).filter((key) => reused.has(sourceByKey.get(key)));
  return { results, outputs, pruned };
}

// ------------------------------------------------------------------ search

const encodeCursor = (item) => Buffer.from(JSON.stringify({ c: item.createdAt, i: String(item._id) })).toString('base64url');

function decodeCursor(raw) {
  try {
    const { c, i } = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
    const createdAt = new Date(c);
    if (Number.isNaN(createdAt.getTime()) || !isValidObjectId(i)) throw new Error('bad');
    return { createdAt, id: new mongoose.Types.ObjectId(i) };
  } catch {
    throw new HttpError(400, 'Invalid cursor');
  }
}

const csv = (value) => String(value).split(',').map((v) => v.trim()).filter(Boolean);

function enumList(query, name, allowed) {
  if (query[name] === undefined || query[name] === '') return null;
  const values = csv(query[name]);
  const bad = values.filter((v) => !allowed.includes(v));
  if (bad.length) throw new HttpError(400, `Invalid ${name}: ${bad.join(', ')} (allowed: ${allowed.join(', ')})`);
  return values;
}

function parseDate(name, raw, { endOfDay = false } = {}) {
  if (raw === undefined || raw === '') return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const date = new Date(dateOnly ? `${raw}T00:00:00.000Z` : raw);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `Invalid ${name}: expected an ISO date`);
  // `to=2026-09-25` means "through the end of that day".
  if (dateOnly && endOfDay) date.setUTCDate(date.getUTCDate() + 1);
  return { date, exclusive: dateOnly && endOfDay };
}

/**
 * `GET /api/runs` (spec/35 §3). Cursor pagination on (createdAt, _id), never
 * `skip`: runs keep arriving while you page, and with skip every arrival shifts
 * the pages under you - a run seen twice, or one missed.
 */
export async function listRuns(req) {
  const q = req.query || {};
  const match = { workspaceId: new mongoose.Types.ObjectId(req.workspaceId) };

  if (q.workflowId) {
    if (!isValidObjectId(q.workflowId)) throw new HttpError(400, 'Invalid workflowId');
    match.workflowId = new mongoose.Types.ObjectId(q.workflowId);
  }
  const statuses = enumList(q, 'status', RUN_STATUSES);
  if (statuses) match.status = { $in: statuses };
  const triggers = enumList(q, 'trigger', TRIGGERS);
  if (triggers) match.trigger = { $in: triggers };
  const failReasons = enumList(q, 'failReason', FAIL_REASONS);
  if (failReasons) match.failReason = { $in: failReasons };

  if (q.version !== undefined && q.version !== '') {
    if (q.version === 'draft') match.isDraft = true;
    else if (/^\d+$/.test(String(q.version)) && Number(q.version) >= 1) match.versionNumber = Number(q.version);
    else throw new HttpError(400, "Invalid version: expected a version number or 'draft'");
  }

  const from = parseDate('from', q.from);
  const to = parseDate('to', q.to, { endOfDay: true });
  if (from && to && from.date > to.date) throw new HttpError(400, 'Invalid date range: from is after to');
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = from.date;
    if (to) match.createdAt[to.exclusive ? '$lt' : '$lte'] = to.date;
  }

  if (q.parentRunId !== undefined && q.parentRunId !== '') {
    if (!isValidObjectId(q.parentRunId)) throw new HttpError(400, 'Invalid parentRunId');
    match.parentRunId = new mongoose.Types.ObjectId(q.parentRunId);
  } else if (q.includeChildren !== undefined && !['true', 'false'].includes(String(q.includeChildren))) {
    throw new HttpError(400, "Invalid includeChildren: expected 'true' or 'false'");
  } else if (String(q.includeChildren) !== 'true') {
    // A 100-item loop would otherwise bury everything else (spec/35 §3).
    match.parentRunId = null;
  }

  const conditions = [];
  if (q.q !== undefined && q.q !== '') {
    if (!/^[0-9a-f]{4,24}$/i.test(String(q.q))) throw new HttpError(400, 'Invalid q: expected at least 4 hex characters of a run id');
    conditions.push({ $expr: { $regexMatch: { input: { $toString: '$_id' }, regex: `^${String(q.q).toLowerCase()}` } } });
  }
  if (q.cursor) {
    const cursor = decodeCursor(q.cursor);
    conditions.push({ $or: [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
    ] });
  }
  if (conditions.length) match.$and = conditions;

  let limit = 25;
  if (q.limit !== undefined && q.limit !== '') {
    limit = Number(q.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'Invalid limit: expected 1-100');
  }

  const rows = await Run.aggregate([
    { $match: scopedFilter(req, match) },
    { $sort: { createdAt: -1, _id: -1 } },
    { $limit: limit + 1 },
    // Lookups run on the page only, never the whole collection.
    { $lookup: { from: 'workflows', localField: 'workflowId', foreignField: '_id', as: 'wf', pipeline: [{ $project: { name: 1 } }] } },
    { $lookup: { from: 'runs', localField: '_id', foreignField: 'parentRunId', as: 'children', pipeline: [{ $project: { _id: 1 } }] } },
    {
      $project: {
        workflowId: 1, status: 1, failReason: 1, cancelReason: 1, trigger: 1, versionNumber: 1, isDraft: 1,
        startedAt: 1, finishedAt: 1, createdAt: 1, rerunOf: 1, retryOf: 1, parentRunId: 1,
        test: { $eq: ['$input.test', true] },
        workflowName: { $arrayElemAt: ['$wf.name', 0] },
        childCount: { $size: '$children' },
      },
    },
  ]);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map((r) => ({
      id: String(r._id),
      workflowId: String(r.workflowId),
      workflowName: r.workflowName ?? '(deleted workflow)',
      status: r.status,
      failReason: r.failReason ?? null,
      cancelReason: r.cancelReason ?? null,
      trigger: r.trigger,
      test: Boolean(r.test),
      versionNumber: r.versionNumber ?? null,
      isDraft: Boolean(r.isDraft),
      startedAt: r.startedAt ?? null,
      finishedAt: r.finishedAt ?? null,
      createdAt: r.createdAt,
      durationMs: r.startedAt && r.finishedAt ? new Date(r.finishedAt) - new Date(r.startedAt) : null,
      rerunOf: r.rerunOf ? String(r.rerunOf) : null,
      retryOf: r.retryOf ? String(r.retryOf) : null,
      parentRunId: r.parentRunId ? String(r.parentRunId) : null,
      childCount: r.childCount,
    })),
    nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
  };
}

// ------------------------------------------------------------------ shared detail

/**
 * The shared run detail (spec/35 §4): a WHITELIST, built field by field, never
 * the run document with things deleted. Execution facts and routing are in;
 * input, outputs, logs, error text, approver identities and child runs are
 * out - they can carry data or identify people.
 */
export function presentSharedRun(run, graph) {
  const durationOf = (a, b) => (a && b ? new Date(b) - new Date(a) : null);
  return {
    run: {
      id: String(run._id),
      status: run.status,
      failReason: run.failReason ?? null,
      trigger: run.trigger,
      versionNumber: run.versionNumber ?? null,
      startedAt: run.startedAt ?? null,
      finishedAt: run.finishedAt ?? null,
      durationMs: durationOf(run.startedAt, run.finishedAt),
    },
    graph: { nodes: graph.nodes, edges: graph.edges },
    nodes: (run.nodeResults || []).map((r) => {
      const routing = {};
      if (r.output && typeof r.output === 'object' && typeof r.output.taken === 'boolean') routing.taken = r.output.taken;
      if (r.handoffTarget) routing.handoffTarget = r.handoffTarget;
      if (r.approval?.decision) routing.approval = r.approval.decision;
      return {
        nodeId: r.nodeId,
        status: r.status,
        startedAt: r.startedAt ?? null,
        finishedAt: r.finishedAt ?? null,
        durationMs: r.durationMs ?? durationOf(r.startedAt, r.finishedAt),
        attempts: r.attempts ?? 1,
        cached: Boolean(r.cached),
        reused: Boolean(r.reused),
        handled: Boolean(r.handled),
        ...(Object.keys(routing).length && { routing }),
        ...(r.status === 'failed' && { summary: `failed after ${r.attempts ?? 1} attempt${(r.attempts ?? 1) === 1 ? '' : 's'}` }),
        ...(r.progress && { progress: { done: r.progress.done, total: r.progress.total } }),
        attemptsLog: (r.attemptsLog || []).map((a) => ({
          attempt: a.attempt,
          startedAt: a.startedAt,
          finishedAt: a.finishedAt,
          durationMs: a.durationMs,
          outcome: a.outcome,
          backoffMs: a.backoffMs ?? null,
          cached: Boolean(a.cached),
        })),
      };
    }),
  };
}

// ------------------------------------------------------------------ node stats

/** Nearest-rank percentile. */
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

/**
 * Per-node stats for one workflow (spec/35 §5): unwinds nodeResults over the
 * runs in range. Only nodes that actually executed count - skipped nodes and
 * nodes a retry reused didn't run. Labels come from the current graph;
 * nodes deleted since show as "(deleted node)".
 */
export async function nodeStatsFor(runMatch, workflow) {
  const rows = await Run.aggregate([
    { $match: runMatch },
    { $unwind: '$nodeResults' },
    { $match: { 'nodeResults.status': { $in: ['success', 'failed'] }, 'nodeResults.reused': { $ne: true } } },
    {
      $group: {
        _id: '$nodeResults.nodeId',
        runs: { $sum: 1 },
        success: { $sum: { $cond: [{ $eq: ['$nodeResults.status', 'success'] }, 1, 0] } },
        handled: { $sum: { $cond: [{ $eq: ['$nodeResults.handled', true] }, 1, 0] } },
        retried: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$nodeResults.attempts', 1] }, 1] }, 1, 0] } },
        cached: { $sum: { $cond: [{ $eq: ['$nodeResults.cached', true] }, 1, 0] } },
        attempts: { $sum: { $ifNull: ['$nodeResults.attempts', 1] } },
        durations: { $push: '$nodeResults.durationMs' },
      },
    },
  ]);
  const byId = new Map((workflow?.nodes || []).map((n) => [n.id, n]));
  return rows
    .map((r) => {
      const node = byId.get(r._id);
      const durations = r.durations.filter((d) => typeof d === 'number' && d >= 0);
      return {
        nodeId: r._id,
        label: node ? node.data?.config?.label || r._id : '(deleted node)',
        type: node?.type ?? null,
        runs: r.runs,
        successRate: r.runs ? r.success / r.runs : null,
        avgDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
        p95DurationMs: percentile(durations, 95),
        avgAttempts: r.runs ? r.attempts / r.runs : null,
        retryRate: r.runs ? r.retried / r.runs : null,
        cacheHitRate: r.runs ? r.cached / r.runs : null,
        handledFailures: r.handled,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
