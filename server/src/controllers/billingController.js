import Membership from '../models/Membership.js';
import Invitation from '../models/Invitation.js';
import { HttpError } from '../middleware/errorHandler.js';
import { scopedFilter } from '../tenancy/scoped.js';
import { PLAN_IDS, planFor, publicPlans } from '../config/plans.js';
import { setPlan } from '../services/planCache.js';
import { getUsage } from '../services/usage.js';
import { runsToday } from '../services/quota.js';
import { presentWorkspace } from '../services/workspaceService.js';
import { queue } from '../queue/index.js';
import { emitToWorkspace } from '../sockets/rooms.js';

/** Members plus live pending invites - what the member limit counts (spec/33 §6). */
export async function seatsUsed(req) {
  const [members, pending] = await Promise.all([
    Membership.countDocuments(scopedFilter(req)),
    Invitation.countDocuments(scopedFilter(req, { status: 'pending', expiresAt: { $gt: new Date() } })),
  ]);
  return members + pending;
}

export function listPlans(req, res) {
  res.json(publicPlans());
}

export async function getWorkspaceUsage(req, res, next) {
  try {
    const plan = planFor(req.workspace.plan);
    const [series, today, seats] = await Promise.all([
      getUsage(req.workspaceId, { days: req.query.days }),
      runsToday(req.workspaceId, req.workspace.plan),
      seatsUsed(req),
    ]);
    const live = queue.statsFor(req.workspaceId);
    res.json({
      plan: { ...plan, concurrencyCap: live.cap },
      limits: { concurrencyCap: live.cap, runsPerDay: plan.runsPerDay, members: plan.members, pool: live.concurrency },
      today: { ...series[series.length - 1], runs: today.used, resetAt: today.resetAt },
      members: { used: seats, limit: plan.members },
      series,
      live,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Plan changes are simulated (spec/33 §4): no payment, no checkout - the plan
 * field just changes. The in-memory plan cache is updated at once, so the new
 * cap applies from the very next dispatch.
 */
export async function changePlan(req, res, next) {
  try {
    const plan = req.body?.plan;
    if (!PLAN_IDS.includes(plan)) throw new HttpError(400, `Plan must be one of: ${PLAN_IDS.join(', ')}`);
    req.workspace.plan = plan;
    await req.workspace.save();
    setPlan(req.workspaceId, plan);
    // Everyone watching this workspace sees the new cap on the queue indicator
    // straight away, even if nothing is queued right now.
    emitToWorkspace(req.workspaceId, 'queue:stats', { workspaceId: req.workspaceId, ...queue.statsFor(req.workspaceId) });
    res.json(presentWorkspace(req.workspace, req.membership));
  } catch (err) {
    next(err);
  }
}
