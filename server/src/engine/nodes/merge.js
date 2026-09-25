import { PermanentFailure } from '../../queue/errors.js';

/**
 * Explicit join semantics (spec/31 §5). `any` is spec/19's default fan-in;
 * `all` is a strict join; `first` fires on the first successful branch.
 */
export default {
  type: 'merge',
  kind: 'orchestration',
  handles: { source: ['default'], error: false },

  /** `first` is the one change to spec/19's readiness rule. */
  isReady(node, { incoming, isResolved, isLive }) {
    const everyResolved = incoming.every((e) => isResolved(e.source));
    if ((node.data?.config?.mode || 'any') !== 'first') return everyResolved;
    return everyResolved || incoming.some((e) => isLive(e));
  },

  async execute(ctx) {
    const { mode = 'any', output: shape = 'keyed' } = ctx.config;
    let live = ctx.live;

    if (mode === 'all') {
      const missing = ctx.incoming.filter((e) => !ctx.isPruned(e) && !live.includes(e));
      if (missing.length) {
        const names = missing.map((e) => ctx.labelOf(e.source)).join(', ');
        throw new PermanentFailure(`branch ${names} did not complete`);
      }
    }
    // The fastest branch, not the first edge: arrival order, not edge order.
    if (mode === 'first') live = ctx.liveByArrival.slice(0, 1);

    const outputs = live.map((e) => ({ source: e.source, output: ctx.outputOf(e.source) }));
    let output;
    if (shape === 'array') output = outputs.map((o) => o.output);
    else if (shape === 'merged') {
      output = {};
      for (const { output: o } of outputs) {
        if (o && typeof o === 'object' && !Array.isArray(o)) Object.assign(output, o);
      }
    } else output = Object.fromEntries(outputs.map((o) => [o.source, o.output]));

    return { output, logs: [`[merge] ${mode} of ${live.length} branch(es) → ${shape}`] };
  },
};
