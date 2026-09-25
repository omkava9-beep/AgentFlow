import { applyMappings, templateScope } from './shared.js';

/**
 * Reshapes data with field mappings - no code (spec/31 §1). Pure and cheap, so
 * it runs inline like a condition rather than taking a queue slot.
 */
export default {
  type: 'transform',
  kind: 'orchestration',
  handles: { source: ['default'], error: false },
  async execute(ctx) {
    const { mode = 'replace', mappings = [] } = ctx.config;
    const logs = [];
    const mapped = applyMappings(mappings, templateScope(ctx), logs);
    const base = ctx.input && typeof ctx.input === 'object' && !Array.isArray(ctx.input) ? ctx.input : {};
    const output = mode === 'merge' ? { ...base, ...mapped } : mapped;
    logs.push(`[transform] ${mode === 'merge' ? 'merged' : 'mapped'} ${Object.keys(mapped).length} field(s)`);
    return { output, logs };
  },
};
