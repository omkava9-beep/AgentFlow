import { IntegrationRegistry } from '../../integrations/IntegrationRegistry.js';
import { normalizeToolConfig } from '../../integrations/normalizeToolConfig.js';

/**
 * Connection resolution, the live/sandbox decision, caching and redaction all
 * live in the registry (spec/26 §4), so every tool call goes through one path.
 */
export default {
  type: 'tool',
  kind: 'work',
  handles: { source: ['default'], error: true },
  maxAttempts: (node) => node.data?.config?.mockOverrides?.maxAttempts,
  async execute(ctx) {
    const result = await IntegrationRegistry.run({ node: ctx.node, input: ctx.input, context: ctx.toolContext });
    return {
      output: result.output,
      logs: result.logs,
      patch: {
        cached: Boolean(result.cached),
        integration: result.integration,
        action: result.action,
        mode: result.mode,
      },
    };
  },
  /** What a failed tool node was trying to call, for the monitor badge and analytics. */
  failurePatch(node, err) {
    const config = normalizeToolConfig(node.data?.config || {}) || {};
    return {
      integration: err.integration ?? (config.integration || null),
      action: err.action ?? (config.action || null),
      mode: err.mode ?? null,
    };
  },
};
