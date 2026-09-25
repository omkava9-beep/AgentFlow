import Workflow from '../models/Workflow.js';
import { createAndStartRun } from './runService.js';

export const EVENT_NAME_RE = /^[A-Za-z0-9._:-]{1,100}$/;

/**
 * Named-event fan-out within ONE workspace (spec/21, namespaced by spec/24). An
 * event name addresses every enabled subscriber in the workspace - that's what
 * distinguishes it from a webhook, which addresses one workflow. Spec/27 reuses
 * this for integration triggers (`<integration>.<trigger>`).
 *
 * A subscriber that can't start (already running, not runnable) is reported in
 * `skipped` rather than aborting the rest.
 */
export async function dispatchWorkspaceEvent(workspaceId, eventName, payload = null, { connectionId = null } = {}) {
  // A subscription filtered to one connection (spec/26 §7) only hears events
  // from that connection; an event with no connection (published through the
  // API, or a test without one) only reaches unfiltered subscribers.
  const connectionFilter = connectionId
    ? { $or: [{ 'eventTrigger.connectionId': null }, { 'eventTrigger.connectionId': connectionId }] }
    : { 'eventTrigger.connectionId': null };
  const workflows = await Workflow.find({
    workspaceId,
    'eventTrigger.eventName': eventName,
    'eventTrigger.enabled': true,
    ...connectionFilter,
  });

  const triggered = [];
  const skipped = [];
  for (const workflow of workflows) {
    const result = await createAndStartRun(workflow, { trigger: 'event', input: payload });
    if (result.ok) triggered.push(result.runId);
    else skipped.push({ workflowId: String(workflow._id), reason: result.reason });
  }
  return { triggered, skipped };
}
