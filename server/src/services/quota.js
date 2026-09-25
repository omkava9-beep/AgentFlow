import UsageCounter from '../models/UsageCounter.js';
import { planFor } from '../config/plans.js';
import { utcDay, nextUtcMidnight } from './usage.js';

/**
 * The daily run quota (spec/33 §5): a product limit ("100 runs a day on Free"),
 * not request rate limiting, which CLAUDE.md still rules out. It counts runs per
 * workspace per UTC day and never throttles anything else.
 *
 * The reservation is atomic: the day's counter is upserted, then incremented
 * only while `runs < limit`. Two triggers racing at `limit - 1` can't both win.
 */
export async function reserveRun(workspaceId, planId) {
  const plan = planFor(planId);
  const day = utcDay();
  const resetAt = nextUtcMidnight();

  if (plan.runsPerDay === null) {
    await UsageCounter.updateOne({ workspaceId, day }, { $inc: { runs: 1 } }, { upsert: true });
    return { ok: true };
  }

  try {
    await UsageCounter.updateOne({ workspaceId, day }, { $setOnInsert: { workspaceId, day } }, { upsert: true });
  } catch (err) {
    // Two first-runs-of-the-day racing on the upsert: the unique index lets one
    // insert; the other's duplicate-key error just means the counter exists.
    if (err?.code !== 11000) throw err;
  }
  const { modifiedCount } = await UsageCounter.updateOne(
    { workspaceId, day, runs: { $lt: plan.runsPerDay } },
    { $inc: { runs: 1 } },
  );
  if (modifiedCount === 1) return { ok: true };
  return { ok: false, limit: plan.runsPerDay, resetAt, planName: plan.name };
}

/** Today's run count and limit, for the Usage page. */
export async function runsToday(workspaceId, planId) {
  const doc = await UsageCounter.findOne({ workspaceId, day: utcDay() }).select('runs').lean();
  return { used: doc?.runs || 0, limit: planFor(planId).runsPerDay, resetAt: nextUtcMidnight() };
}

/**
 * The HTTP shape every run-starting route uses for `quota-exceeded`: 429 with
 * the limit and reset time, plus Retry-After so a well-behaved client waits.
 */
export function sendQuotaExceeded(res, result) {
  const retryAfterS = Math.max(1, Math.ceil((new Date(result.resetAt) - Date.now()) / 1000));
  res.set('Retry-After', String(retryAfterS));
  return res.status(429).json({
    error: `Daily run limit reached for the ${result.planName || 'current'} plan`,
    limit: result.limit,
    resetAt: result.resetAt,
  });
}
