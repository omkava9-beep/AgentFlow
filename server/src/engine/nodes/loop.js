import { env } from '../../config/env.js';
import { PermanentFailure } from '../../queue/errors.js';
import { resolveValue } from '../../integrations/template.js';
import { childFailure, childOutput, loadWorkflowInWorkspace, RunCancelledError, templateScope } from './shared.js';

/**
 * Runs a body workflow once per item (spec/31 §4), with at most `concurrency`
 * child runs in flight, and collects results in index order. The body is a
 * workflow reference, not an inline subgraph: each iteration is an ordinary,
 * inspectable child Run and the flat one-result-per-node model stays intact.
 */
export default {
  type: 'loop',
  kind: 'orchestration',
  handles: { source: ['default'], error: true },
  async execute(ctx) {
    const { itemsPath, workflowId, continueOnError = false } = ctx.config;
    const concurrency = Math.min(Math.max(Number(ctx.config.concurrency) || 3, 1), 10);
    const maxItems = Math.min(Number(ctx.config.maxItems) || 100, env.loopMaxItems);
    const logs = [];

    const items = resolveValue(itemsPath, templateScope(ctx), logs);
    if (!Array.isArray(items)) {
      throw new PermanentFailure(`Loop items (${itemsPath || 'no itemsPath'}) did not resolve to an array`);
    }
    if (items.length > maxItems) {
      throw new PermanentFailure(
        `Loop has ${items.length} items; the limit is ${maxItems}. Raise maxItems or pre-filter with a Transform.`,
      );
    }
    const total = items.length;
    const body = await loadWorkflowInWorkspace(workflowId, ctx.workspaceId, 'Loop body workflow');

    const results = new Array(total);
    let next = 0;
    let done = 0;
    let stopped = false;
    let firstFailure = null;

    // Child run ids are tracked by the engine's startChildRun; this streams the
    // `done / total` the canvas shows.
    const report = () => ctx.updateResult({ progress: { done, total } });
    await report();

    async function worker() {
      while (!stopped && next < total && !ctx.signal.isCancelled()) {
        const index = next++;
        let entry;
        try {
          const { runId, run } = await ctx.startChildRun(body, {
            input: { item: items[index], index, total, parent: ctx.input },
            iteration: index,
          });
          entry = { index, status: run?.status || 'failed', output: run?.status === 'success' ? childOutput(run, body) : null, runId };
          if (entry.status !== 'success' && !firstFailure) firstFailure = `iteration ${index} ${childFailure(run, body)}`;
        } catch (err) {
          // A body deleted mid-loop (or any dispatch failure) fails that item.
          entry = { index, status: 'failed', output: null, runId: null, error: err.message };
          if (!firstFailure) firstFailure = `iteration ${index}: ${err.message}`;
        }
        results[index] = entry;
        done += 1;
        await report();
        // Default: the first failure stops new dispatches; in-flight ones finish.
        if (entry.status !== 'success' && !continueOnError) stopped = true;
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
    if (ctx.signal.isCancelled()) throw new RunCancelledError();

    const settled = results.filter(Boolean);
    const succeeded = settled.filter((r) => r.status === 'success').length;
    const failed = settled.length - succeeded;
    logs.push(`[loop] ${succeeded}/${total} iteration(s) succeeded (concurrency ${concurrency})`);

    if (failed && !continueOnError) {
      const err = new Error(`Loop stopped: ${firstFailure}`);
      err.logs = logs;
      throw err;
    }
    if (continueOnError && total > 0 && settled.length === 0) {
      throw new Error('Loop ran no iterations');
    }
    return { output: { results: settled, succeeded, failed, total }, logs };
  },
};
