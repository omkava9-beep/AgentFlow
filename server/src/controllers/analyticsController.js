import mongoose from 'mongoose';
import Run from '../models/Run.js';
import Workflow from '../models/Workflow.js';
import { scopedFilter, findInWorkspace } from '../tenancy/scoped.js';
import { nodeStatsFor } from '../services/runOpsService.js';
import { normalizeToolConfig } from '../integrations/normalizeToolConfig.js';

/**
 * `[{ type: 'builtin.calculator', integration, action, count }]`, most used
 * first. Nodes with no integration or action picked yet are left out.
 */
function groupToolUsage(rows) {
  const counts = new Map();
  for (const { config } of rows) {
    const { integration, action } = normalizeToolConfig(config || {}) || {};
    if (!integration || !action) continue;
    const type = `${integration}.${action}`;
    const entry = counts.get(type) || { type, integration, action, count: 0 };
    entry.count += 1;
    counts.set(type, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

const ALLOWED_RANGES = [7, 30, 90];
const DEFAULT_RANGE = 30;

/**
 * Everything here is UTC on purpose. `$dateToString` buckets in UTC unless given
 * a timezone, so building the day list from *local* midnight silently shifts the
 * whole series: in UTC+5:30, local midnight is 18:30 UTC the previous day, which
 * pushed every key back a day and dropped today's runs off the chart entirely.
 * One clock throughout is the fix.
 */
function rangeStart(days) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
}

const dayKey = (date) => date.toISOString().slice(0, 10);

/** Zero-fills the gaps so the line chart doesn't imply activity across quiet days. */
function fillDays(counts, days) {
  const byDate = new Map(counts.map((c) => [c._id, c.count]));
  const out = [];
  const cursor = rangeStart(days);
  for (let i = 0; i < days; i++) {
    const key = dayKey(cursor);
    out.push({ date: key, count: byDate.get(key) || 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export async function summary(req, res, next) {
  try {
    const days = ALLOWED_RANGES.includes(Number(req.query.days)) ? Number(req.query.days) : DEFAULT_RANGE;
    // aggregate() skips Mongoose casting, so the id has to be an ObjectId here.
    const workspaceId = new mongoose.Types.ObjectId(req.workspaceId);
    const since = rangeStart(days);
    // spec/35 §5: `?workflowId=` narrows every aggregation to one workflow and
    // adds per-node stats. A foreign or unknown id is a 404, as everywhere.
    const workflowId = req.params.workflowId || req.query.workflowId || null;
    const workflow = workflowId ? await findInWorkspace(Workflow, workflowId, req, { lean: true }) : null;
    const only = workflow ? { workflowId: workflow._id } : {};
    const runMatch = scopedFilter(req, { workspaceId, createdAt: { $gte: since }, ...only });
    const workflowMatch = scopedFilter(req, { workspaceId, ...(workflow && { _id: workflow._id }) });

    const [totals, byDay, byTrigger, nodeTypes, toolTypes, nodeStats] = await Promise.all([
      Run.aggregate([
        { $match: runMatch },
        {
          $group: {
            _id: null,
            totalRuns: { $sum: 1 },
            success: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
            cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
            active: { $sum: { $cond: [{ $in: ['$status', ['pending', 'running']] }, 1, 0] } },
            durations: {
              $push: {
                $cond: [
                  { $and: [{ $ne: ['$startedAt', null] }, { $ne: ['$finishedAt', null] }] },
                  { $subtract: ['$finishedAt', '$startedAt'] },
                  null,
                ],
              },
            },
          },
        },
      ]),

      Run.aggregate([
        { $match: runMatch },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),

      Run.aggregate([
        { $match: runMatch },
        { $group: { _id: { $ifNull: ['$trigger', 'manual'] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // Node-type usage is design-time - "across all workflows", per spec/14 - so
      // it aggregates over Workflow.nodes rather than run results. Deriving it
      // from runs would mean joining every nodeResult back to its workflow's node
      // list to recover a type that nodeResults doesn't store.
      Workflow.aggregate([
        { $match: workflowMatch },
        { $unwind: '$nodes' },
        { $group: { _id: '$nodes.type', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // Grouped by integration.action (spec/26). Both node shapes are read and
      // normalized in JS, so a workflow saved before the tool-node migration
      // still counts under its new name.
      Workflow.aggregate([
        { $match: workflowMatch },
        { $unwind: '$nodes' },
        { $match: { 'nodes.type': 'tool' } },
        { $project: { _id: 0, config: '$nodes.data.config' } },
      ]),

      workflow ? nodeStatsFor(runMatch, workflow) : null,
    ]);

    const t = totals[0] || { totalRuns: 0, success: 0, failed: 0, cancelled: 0, active: 0, durations: [] };
    const durations = (t.durations || []).filter((d) => typeof d === 'number' && d >= 0);
    // Rate is over *finished* runs: counting in-flight ones would drag it down
    // for no reason while a run is still going.
    const finished = t.success + t.failed + t.cancelled;

    res.json({
      rangeDays: days,
      since,
      totalRuns: t.totalRuns,
      statusBreakdown: { success: t.success, failed: t.failed, cancelled: t.cancelled, active: t.active },
      successRate: finished ? t.success / finished : null,
      avgDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      medianDurationMs: median(durations),
      runsByDay: fillDays(byDay, days),
      runsByTrigger: byTrigger.map((b) => ({ trigger: b._id, count: b.count })),
      topNodeTypes: nodeTypes.map((n) => ({ type: n._id, count: n.count })),
      topToolTypes: groupToolUsage(toolTypes),
      ...(workflow && { workflowId: String(workflow._id), workflowName: workflow.name, nodeStats }),
    });
  } catch (err) {
    next(err);
  }
}
