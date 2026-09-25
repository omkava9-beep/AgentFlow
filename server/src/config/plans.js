import { env } from './env.js';

/**
 * The simulated plans (spec/33) - the ONLY place plan limits live. Nothing is
 * ever charged; plans exist to drive the per-workspace concurrency cap, the
 * daily run quota and the member limit. `null` means unlimited.
 *
 * Enterprise's cap is the whole pool rather than a number of its own, so it can
 * never promise more concurrency than the process actually has.
 */
export const PLANS = {
  free: { id: 'free', name: 'Free', concurrencyCap: 2, runsPerDay: 100, members: 5 },
  team: { id: 'team', name: 'Team', concurrencyCap: 4, runsPerDay: 2000, members: 25 },
  enterprise: { id: 'enterprise', name: 'Enterprise', concurrencyCap: env.queueConcurrency, runsPerDay: null, members: null },
};

export const PLAN_IDS = Object.keys(PLANS);
export const DEFAULT_PLAN = 'free';

/** Unknown or missing plan ids fall back to Free, the schema default. */
export function planFor(planId) {
  return PLANS[planId] || PLANS[DEFAULT_PLAN];
}

/** What `GET /api/plans` returns: limits only - there are no prices to show. */
export function publicPlans() {
  return PLAN_IDS.map((id) => ({ ...PLANS[id], concurrencyCap: Math.min(PLANS[id].concurrencyCap, env.queueConcurrency) }));
}
