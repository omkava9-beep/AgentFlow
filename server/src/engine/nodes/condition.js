import { evaluateCondition } from '../conditionEval.js';

export default {
  type: 'condition',
  kind: 'orchestration',
  handles: { source: ['true', 'false'], error: false },
  async execute(ctx) {
    const { expression } = ctx.config;
    const taken = evaluateCondition(expression, ctx.input);
    const takenHandle = taken ? 'true' : 'false';
    ctx.pushLog(`[condition] "${expression}" evaluated to ${taken}`);
    ctx.pruneOutgoing((edge) => edge.sourceHandle !== takenHandle);
    // Downstream nodes see the condition's own input, not `{ taken }`; the
    // persisted output records which way it went.
    return { output: { taken }, passThrough: ctx.input, patch: { attempts: 1 } };
  },
};
