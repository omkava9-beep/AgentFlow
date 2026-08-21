import mongoose from 'mongoose';
import Run from '../models/Run.js';
import Workflow from '../models/Workflow.js';

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
    const ownerId = new mongoose.Types.ObjectId(req.userId);
    const since = rangeStart(days);
    const runMatch = { ownerId, createdAt: { $gte: since } };

    const [totals, byDay, byTrigger, nodeTypes, toolTypes] = await Promise.all([
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
        { $match: { ownerId } },
        { $unwind: '$nodes' },
        { $group: { _id: '$nodes.type', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      Workflow.aggregate([
        { $match: { ownerId } },
        { $unwind: '$nodes' },
        { $match: { 'nodes.type': 'tool', 'nodes.data.config.toolType': { $nin: [null, ''] } } },
        { $group: { _id: '$nodes.data.config.toolType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
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
      topToolTypes: toolTypes.map((n) => ({ type: n._id, count: n.count })),
    });
  } catch (err) {
    next(err);
  }
}
