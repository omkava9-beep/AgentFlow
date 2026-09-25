/**
 * The node executor registry (spec/31 §0). Each entry is
 *   { type, kind: 'work' | 'orchestration' | (node) => kind,
 *     handles: { source: string[], error: boolean },
 *     execute(ctx), isReady?(node, readiness), onSuccess?(ctx, result),
 *     maxAttempts?(node), failurePatch?(node, err) }
 *
 * `work` executors go through the queue; `orchestration` executors are awaited
 * by the engine and never hold a slot - the rule that keeps a loop of
 * sub-workflows from deadlocking the pool (spec/33 §3).
 */
import start from './start.js';
import end from './end.js';
import condition from './condition.js';
import agent from './agent.js';
import tool from './tool.js';
import transform from './transform.js';
import code from './code.js';
import delay from './delay.js';
import loop from './loop.js';
import merge from './merge.js';
import subworkflow from './subworkflow.js';
import approval from './approval.js';

export const NODE_EXECUTORS = Object.fromEntries(
  [start, end, condition, agent, tool, transform, code, delay, loop, merge, subworkflow, approval].map((e) => [e.type, e]),
);

export const NODE_TYPES = Object.keys(NODE_EXECUTORS);

export function executorFor(type) {
  return NODE_EXECUTORS[type] || null;
}

export function kindOf(node) {
  const executor = executorFor(node.type);
  if (!executor) return null;
  return typeof executor.kind === 'function' ? executor.kind(node) : executor.kind;
}

/** Whether edges with `sourceHandle: 'error'` may leave this node type. */
export function supportsErrorHandle(type) {
  return Boolean(executorFor(type)?.handles?.error);
}
