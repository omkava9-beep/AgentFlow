import Workflow from '../models/Workflow.js';
import Run from '../models/Run.js';
import Membership from '../models/Membership.js';
import Invitation from '../models/Invitation.js';
import Connection from '../models/Connection.js';
import WorkflowVersion from '../models/WorkflowVersion.js';
import { scopedFilter } from '../tenancy/scoped.js';
import { can } from '../tenancy/permissions.js';
import { planFor } from '../config/plans.js';
import { seatsUsed } from './billingController.js';

/**
 * The onboarding checklist (spec/36 §2). Every step is answered by an `exists`
 * query over data the workspace already has, so nothing is tracked separately
 * and nothing can drift: creating a workflow ticks step 1 with no extra write.
 * `permission` is the action a member needs to do the step themselves; the card
 * shows "ask an admin" when they can't.
 */
const STEPS = [
  { key: 'create_workflow', permission: 'workflow:edit', done: (req) => Workflow.exists(scopedFilter(req)) },
  { key: 'run_workflow', permission: 'workflow:run', done: (req) => Run.exists(scopedFilter(req)) },
  {
    key: 'invite_teammate',
    permission: 'members:invite',
    done: async (req) => Boolean(
      await Membership.exists(scopedFilter(req, { userId: { $ne: req.userId } }))
      || await Invitation.exists(scopedFilter(req, { status: 'pending' })),
    ),
  },
  { key: 'add_connection', permission: 'connections:manage', done: (req) => Connection.exists(scopedFilter(req)) },
  { key: 'publish_version', permission: 'workflow:publish', done: (req) => WorkflowVersion.exists(scopedFilter(req)) },
  {
    key: 'set_up_trigger',
    permission: 'triggers:manage',
    done: (req) => Workflow.exists(scopedFilter(req, {
      $or: [{ 'schedule.enabled': true }, { 'webhook.enabled': true }, { 'eventTrigger.enabled': true }],
    })),
  },
];

export async function getOnboarding(req, res, next) {
  try {
    const steps = await Promise.all(STEPS.map(async ({ key, permission, done }) => ({
      key,
      done: Boolean(await done(req)),
      canDo: can(req.role, permission),
    })));
    res.json({
      steps,
      // Per person (spec/36 §2): Bob dismissing it doesn't hide it for Alice.
      dismissed: Boolean(req.membership.onboardingDismissedAt),
      complete: steps.every((s) => s.done),
    });
  } catch (err) {
    next(err);
  }
}

/** POST .../onboarding/dismiss, and PATCH .../onboarding { dismissed } for undoing it. */
export async function setOnboardingDismissed(req, res, next) {
  try {
    const dismissed = req.method === 'POST' ? true : req.body?.dismissed !== false;
    await Membership.updateOne(
      { _id: req.membership._id },
      { $set: { onboardingDismissedAt: dismissed ? new Date() : null } },
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/**
 * Seats against the plan's member limit (spec/33 §6), so the invite dialog can
 * explain why Send is disabled instead of waiting for the server's 403.
 * Seats are members plus live pending invites - the same count the limit uses.
 */
export async function getSeats(req, res, next) {
  try {
    const plan = planFor(req.workspace.plan);
    const used = await seatsUsed(req);
    res.json({
      seatsUsed: used,
      seatLimit: plan.members,
      plan: { id: plan.id, name: plan.name },
      atLimit: plan.members !== null && used >= plan.members,
    });
  } catch (err) {
    next(err);
  }
}
