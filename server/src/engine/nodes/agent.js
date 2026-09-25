import { getAgentProvider } from '../../config/agentProvider.js';
import { PermanentFailure } from '../../queue/errors.js';
import { runAgentLoop } from '../agentLoop.js';

const hasTools = (node) => Array.isArray(node.data?.config?.tools) && node.data.config.tools.length > 0;

/**
 * One model call is one queue job. An agent WITH tools is the mixed case
 * (spec/31 §0, spec/37): its turns and tool calls become separate jobs driven
 * by the engine, so it's orchestration and never holds a slot while waiting on
 * its own tool calls.
 */
export default {
  type: 'agent',
  kind: (node) => (hasTools(node) ? 'orchestration' : 'work'),
  handles: { source: ['default'], error: true },
  maxAttempts: (node) => node.data?.config?.mockOverrides?.maxAttempts,
  async execute(ctx) {
    // spec/37: each model turn and each tool call is its own queue job with the
    // workspace meta, driven by the engine - so this node never holds a slot.
    if (hasTools(ctx.node)) return runAgentLoop(ctx);
    const result = await getAgentProvider().run(ctx.config, ctx.input);
    return { output: result.output, logs: result.logs, handoffTarget: result.handoffTarget };
  },
  /** Handoff routing (spec/16): runs in the engine after the job succeeds. */
  onSuccess(ctx, result) {
    if (!ctx.config?.isHandoff) return {};
    const outgoing = ctx.outgoing.filter((e) => e.sourceHandle !== 'error');
    const target = result.handoffTarget;
    const validTargets = new Set(outgoing.map((e) => e.label));
    if (!target || !validTargets.has(target)) {
      throw new PermanentFailure(`Agent selected unknown handoff target: ${target}`);
    }
    ctx.pruneOutgoing((edge) => edge.sourceHandle !== 'error' && edge.label !== target);
    ctx.pushLog(`[handoff] routing to "${target}"`);
    return { handoffTarget: target };
  },
};
