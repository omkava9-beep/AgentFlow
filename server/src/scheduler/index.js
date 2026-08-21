import cron from 'node-cron';
import Workflow from '../models/Workflow.js';
import { startRunForWorkflowId, SKIP_REASONS } from '../services/runService.js';

/**
 * In-process cron registry (spec/12). Keyed by workflow id so enabling, editing
 * or disabling a schedule can start/stop exactly one job without a restart.
 *
 * node-cron jobs live only in memory, so `bootstrapSchedules()` re-registers
 * everything from MongoDB on boot — otherwise a restart would silently stop
 * every schedule the user thinks is still running.
 */
const tasks = new Map();

export function isValidCron(expression) {
  return Boolean(expression) && cron.validate(expression);
}

export function unregisterSchedule(workflowId) {
  const task = tasks.get(String(workflowId));
  if (!task) return false;
  task.stop();
  tasks.delete(String(workflowId));
  return true;
}

export function registerSchedule(workflow) {
  const id = String(workflow._id);
  unregisterSchedule(id);

  const { cronExpression, enabled } = workflow.schedule || {};
  if (!enabled || !isValidCron(cronExpression)) return false;

  const task = cron.schedule(cronExpression, async () => {
    // Reload the workflow each tick: the graph (or the schedule itself) may have
    // changed since registration, and a stale in-memory copy would run old logic.
    const result = await startRunForWorkflowId(id, { trigger: 'schedule' });
    if (result.ok) {
      console.log(`[scheduler] ${id} -> run ${result.runId}`);
    } else if (result.reason === SKIP_REASONS.ALREADY_RUNNING) {
      console.log(`[scheduler] ${id} skipped: a run is already in progress`);
    } else {
      console.log(`[scheduler] ${id} skipped: ${result.reason}`);
    }
  });

  tasks.set(id, task);
  return true;
}

export async function bootstrapSchedules() {
  const workflows = await Workflow.find({ 'schedule.enabled': true });
  let count = 0;
  for (const workflow of workflows) {
    if (registerSchedule(workflow)) count += 1;
  }
  console.log(`[scheduler] registered ${count} schedule(s) on startup`);
  return count;
}

export function activeScheduleCount() {
  return tasks.size;
}
