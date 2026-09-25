import mongoose from 'mongoose';
import Workflow from '../../models/Workflow.js';
import WorkflowVersion from '../../models/WorkflowVersion.js';
import { PermanentFailure } from '../../queue/errors.js';
import { resolveValue } from '../../integrations/template.js';

/**
 * Thrown by orchestration nodes when the run is cancelled (or times out) while
 * they wait. The engine treats it as "the node never finished" - skipped - and
 * never routes it down an error edge (spec/31 §7).
 */
export class RunCancelledError extends Error {
  constructor() {
    super('run cancelled');
    this.name = 'RunCancelledError';
    this.cancelled = true;
  }
}

/** Template scope for engine-evaluated node templates (spec/31 §1). */
export function templateScope(ctx) {
  return {
    input: ctx.input,
    run: { id: ctx.run.id, trigger: ctx.run.trigger, input: ctx.run.input },
    now: new Date().toISOString(),
  };
}

/** Sets `a.b.c` on `target`, creating intermediate objects as needed. */
export function setPath(target, dottedKey, value) {
  const keys = String(dottedKey).split('.').filter(Boolean);
  if (!keys.length) return;
  let cursor = target;
  for (const key of keys.slice(0, -1)) {
    if (cursor[key] === null || typeof cursor[key] !== 'object') cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = value;
}

/** `[{ key, value }]` template mappings → a new object. Shared by Transform and Sub-workflow. */
export function applyMappings(mappings, scope, logs) {
  const out = {};
  for (const { key, value } of mappings || []) {
    if (!key || !String(key).trim()) continue;
    setPath(out, String(key).trim(), resolveValue(value, scope, logs));
  }
  return out;
}

/**
 * Loads a workflow referenced by a loop or sub-workflow node. Always scoped to
 * the parent run's workspace: a crafted id from another tenant resolves to
 * "not found" exactly like a deleted one (spec/31 §6).
 */
export async function loadWorkflowInWorkspace(workflowId, workspaceId, what = 'Sub-workflow') {
  if (!workflowId || !mongoose.isValidObjectId(workflowId)) {
    throw new PermanentFailure(`${what} not found`);
  }
  const workflow = await Workflow.findOne({ _id: workflowId, workspaceId }).lean();
  if (!workflow) throw new PermanentFailure(`${what} not found`);
  // spec/30 §2: a child runs its PUBLISHED version, never someone's half-edited
  // draft. The returned object carries that version's graph, and its
  // publishedVersionId pins createAndStartRun to exactly this version.
  const version = workflow.publishedVersionId
    && await WorkflowVersion.findOne({ _id: workflow.publishedVersionId, workspaceId }).lean();
  if (!version) throw new PermanentFailure(`"${workflow.name}" has no published version`);
  return { ...workflow, name: version.name, nodes: version.nodes, edges: version.edges, publishedVersionId: version._id };
}

/** The value a child run produced: its (first successful) End node's output. */
export function childOutput(childRun, childWorkflow) {
  const endIds = (childWorkflow.nodes || []).filter((n) => n.type === 'end').map((n) => n.id);
  const results = childRun?.nodeResults || [];
  const end = endIds
    .map((id) => results.find((r) => r.nodeId === id))
    .find((r) => r && r.status === 'success');
  return end ? end.output ?? null : null;
}

/** "failed at node X" for a failed child, so the parent's log says where. */
export function childFailure(childRun, childWorkflow) {
  const labels = new Map((childWorkflow.nodes || []).map((n) => [n.id, n.data?.config?.label || n.id]));
  const failed = (childRun?.nodeResults || []).find((r) => r.status === 'failed' && !r.handled);
  if (childRun?.status === 'cancelled') return `was cancelled`;
  if (!failed) return `ended ${childRun?.status || 'without a result'}`;
  const lastLog = (failed.logs || []).at(-1);
  return `failed at node "${labels.get(failed.nodeId) || failed.nodeId}"${lastLog ? `: ${lastLog}` : ''}`;
}
