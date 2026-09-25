/**
 * Persists its input as its own output: the End node's input IS the workflow's
 * final result, and it's what a parent sub-workflow or loop reads back.
 */
export default {
  type: 'end',
  kind: 'orchestration',
  handles: { source: [], error: false },
  async execute(ctx) {
    return { output: ctx.input };
  },
};
