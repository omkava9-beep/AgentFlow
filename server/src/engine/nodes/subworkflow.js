import { applyMappings, childFailure, childOutput, loadWorkflowInWorkspace, templateScope } from './shared.js';

/**
 * Calls another workflow in the same workspace as a real child Run (spec/31 §6).
 * Orchestration: it waits for the child without holding a queue slot, while the
 * child's own work nodes queue under the same workspace cap.
 */
export default {
  type: 'subworkflow',
  kind: 'orchestration',
  handles: { source: ['default'], error: true },
  async execute(ctx) {
    const { workflowId, inputMapping } = ctx.config;
    const child = await loadWorkflowInWorkspace(workflowId, ctx.workspaceId, 'Sub-workflow');
    const logs = [];
    const childInput = Array.isArray(inputMapping) && inputMapping.length
      ? applyMappings(inputMapping, templateScope(ctx), logs)
      : ctx.input;

    const { runId, run } = await ctx.startChildRun(child, { input: childInput });
    logs.push(`[subworkflow] "${child.name}" ran as ${runId}: ${run?.status || 'unknown'}`);
    if (run?.status !== 'success') {
      const err = new Error(`Sub-workflow "${child.name}" ${childFailure(run, child)}`);
      err.logs = logs;
      throw err;
    }
    return { output: childOutput(run, child), logs };
  },
};
