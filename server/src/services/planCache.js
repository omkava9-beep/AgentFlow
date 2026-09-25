import Workspace from '../models/Workspace.js';
import { planFor } from '../config/plans.js';
import { env } from '../config/env.js';

/**
 * In-memory workspace → plan id map, so the queue can ask for a cap
 * synchronously and never touch MongoDB itself (spec/33 §2).
 *
 * Filled lazily: `createAndStartRun` awaits `ensurePlanLoaded()` before a run
 * enqueues anything, so a run's first dispatch already sees the right cap. Plan
 * changes through the API call `setPlan()`, which also tells the queue to
 * re-dispatch (a raised cap should start queued jobs straight away). A plan
 * edited directly in MongoDB needs a restart - documented, not handled.
 *
 * A workspace id with no Workspace document (the engine check drives the engine
 * with a made-up one) is cached as `null` and treated as uncapped: there's no
 * tenant there to be fair to.
 */
const plans = new Map(); // workspaceId -> plan id | null (no such workspace)
const listeners = new Set();

const loading = new Map(); // workspaceId -> in-flight lookup, so a burst of misses is one query

export async function ensurePlanLoaded(workspaceId) {
  const id = String(workspaceId);
  if (plans.has(id)) return plans.get(id);
  if (!loading.has(id)) {
    loading.set(id, (async () => {
      const ws = await Workspace.findById(id).select('plan').lean().catch(() => null);
      const plan = ws ? ws.plan || 'free' : null;
      plans.set(id, plan);
      loading.delete(id);
      // Either way the cap may differ from the Free default assumed meanwhile,
      // so let the queue re-dispatch with the real one.
      notify(id);
      return plan;
    })());
  }
  return loading.get(id);
}

/** The plan id if known; kicks off a load (and assumes Free meanwhile) if not. */
export function planIdFor(workspaceId) {
  const id = String(workspaceId);
  if (!plans.has(id)) {
    ensurePlanLoaded(id);
    return 'free';
  }
  return plans.get(id);
}

/** The queue's injected `capFor`. Always at least 1, never more than the pool. */
export function capFor(workspaceId) {
  const planId = planIdFor(workspaceId);
  if (planId === null) return Infinity;
  return Math.max(1, Math.min(planFor(planId).concurrencyCap, env.queueConcurrency));
}

export function setPlan(workspaceId, planId) {
  plans.set(String(workspaceId), planId);
  notify(String(workspaceId));
}

export function forgetPlan(workspaceId) {
  plans.delete(String(workspaceId));
}

/** `listener(workspaceId)` - the queue re-dispatches when a cap may have changed. */
export function onPlanChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(workspaceId) {
  for (const listener of listeners) listener(workspaceId);
}
