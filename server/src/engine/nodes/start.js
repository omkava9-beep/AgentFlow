/** Hands the trigger's payload (webhook/event/API body, loop item) to the graph. */
export default {
  type: 'start',
  kind: 'orchestration',
  handles: { source: ['default'], error: false },
  async execute(ctx) {
    return { output: ctx.run.input };
  },
};
