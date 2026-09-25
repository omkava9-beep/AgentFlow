/**
 * Standing validation for the builder canvas (spec/20).
 *
 * The error/warning split is the point: an **error** means the graph is not a
 * workflow at all (so saving is blocked), while a **warning** means it's a valid
 * shape that won't execute correctly yet (so saving is fine, running is not).
 * Phase 1 blocked *saving* on a missing Start node, which meant an in-progress
 * graph couldn't be parked.
 */

import { normalizeToolConfig, legacyTarget } from './normalizeToolConfig.js';
import {
  catalogFromLegacyTools,
  findIntegration,
  jsonParamError,
  looksLikeSecret,
  needsCredentials,
} from './integrationCatalog.js';
import { validateAdvanced } from './validateAdvancedNodes.js';
import { validateMcpToolNode, validateAgentTools } from './validateMcp.js';

function hasCycle(nodes, edges) {
  const adjacency = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) adjacency.get(e.source)?.push(e.target);

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(nodes.map((n) => [n.id, WHITE]));

  function dfs(id) {
    color.set(id, GRAY);
    for (const next of adjacency.get(id) || []) {
      if (color.get(next) === GRAY) return true;
      if (color.get(next) === WHITE && dfs(next)) return true;
    }
    color.set(id, BLACK);
    return false;
  }

  return nodes.some((n) => color.get(n.id) === WHITE && dfs(n.id));
}

function reachableFrom(startId, nodes, edges) {
  const adjacency = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) adjacency.get(e.source)?.push(e.target);

  const seen = new Set([startId]);
  const stack = [startId];
  while (stack.length) {
    for (const next of adjacency.get(stack.pop()) || []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}

function expressionParses(expression) {
  try {
    // eslint-disable-next-line no-new-func
    new Function('output', `"use strict"; return Boolean(${expression});`);
    return true;
  } catch {
    return false;
  }
}

const sameSet = (a, b) => {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/**
 * `integrations` is the spec/26 catalogue (null while it loads, which skips the
 * catalogue-dependent checks rather than flagging everything as unknown).
 * `connections` is the workspace's connection list (null = not loaded). A
 * phase-2 `tools` list is still accepted and converted.
 *
 * Returns `{ errors, warnings, info }`. `info` is advisory only — it never
 * blocks saving or running.
 */
function collectProblems({ nodes = [], edges = [], integrations = null, connections = null, tools = null, workflows = null, currentWorkflowId = null }) {
  const errors = [];
  const warnings = [];
  const info = [];
  const catalog = integrations || (tools ? catalogFromLegacyTools(tools, legacyTarget) : null);
  const label = (n) => n.data?.config?.label || n.id;

  if (!nodes.length) {
    errors.push({ id: 'empty', message: 'The canvas is empty — add a node to get started.' });
    return { errors, warnings, info };
  }

  const startNodes = nodes.filter((n) => n.type === 'start');
  if (!startNodes.length) {
    errors.push({ id: 'no-start', message: 'Workflow needs a Start node.' });
  }

  if (hasCycle(nodes, edges)) {
    errors.push({ id: 'cycle', message: 'The graph contains a cycle — execution would never finish.' });
  }

  const endNodes = nodes.filter((n) => n.type === 'end');
  if (!endNodes.length) {
    warnings.push({ id: 'no-end', message: 'No End node — the workflow has no defined result.' });
  } else if (endNodes.length > 1) {
    warnings.push({ id: 'many-end', message: `${endNodes.length} End nodes — only one is meaningful.` });
  }

  const outgoing = (id) => edges.filter((e) => e.source === id);

  for (const node of nodes) {
    if (node.type === 'tool') validateToolNode(node, { catalog, connections, errors, warnings, info, label });

    if (node.type === 'condition') {
      const expression = node.data?.config?.expression || '';
      if (!expression.trim()) {
        warnings.push({ id: `cond-empty:${node.id}`, nodeId: node.id, message: `"${label(node)}" has no expression.` });
      } else if (!expressionParses(expression)) {
        warnings.push({ id: `cond-invalid:${node.id}`, nodeId: node.id, message: `"${label(node)}" has an invalid expression.` });
      }
      const handles = outgoing(node.id).map((e) => e.sourceHandle);
      const missing = ['true', 'false'].filter((h) => !handles.includes(h));
      if (missing.length) {
        warnings.push({
          id: `cond-branch:${node.id}`,
          nodeId: node.id,
          message: `"${label(node)}" has no ${missing.join(' or ')} branch — that path dead-ends.`,
        });
      }
    }

    // spec/37: MCP tools and integration actions an agent may call.
    if (node.type === 'agent') validateAgentTools(node, { catalog, connections, errors, warnings, name: label(node) });

    if (node.type === 'agent' && node.data?.config?.isHandoff) {
      const candidates = node.data.config.candidates || [];
      const edgeLabels = outgoing(node.id).map((e) => e.label).filter(Boolean);
      if (!candidates.length) {
        warnings.push({ id: `handoff-empty:${node.id}`, nodeId: node.id, message: `"${label(node)}" is a handoff agent with no candidates.` });
      } else if (!sameSet(candidates, edgeLabels)) {
        warnings.push({
          id: `handoff-mismatch:${node.id}`,
          nodeId: node.id,
          message: `"${label(node)}" candidates [${candidates.join(', ')}] don't match its edge labels [${edgeLabels.join(', ') || 'none'}].`,
        });
      }
    }
  }

  // spec/31: transform, code, delay, loop, merge, sub-workflow and error edges.
  validateAdvanced({ nodes, edges, workflows, currentWorkflowId, errors, warnings, label });

  if (startNodes.length) {
    const reachable = reachableFrom(startNodes[0].id, nodes, edges);
    for (const node of nodes) {
      if (!reachable.has(node.id)) {
        warnings.push({ id: `unreachable:${node.id}`, nodeId: node.id, message: `"${label(node)}" is unreachable from Start.` });
      }
    }
  }

  return { errors, warnings, info };
}

/** spec/26 §8 + spec/25's connection checks for one tool node. */
function validateToolNode(node, { catalog, connections, errors, warnings, info, label }) {
  const config = normalizeToolConfig(node.data?.config || {});
  const name = label(node);
  const at = (kind, suffix = '') => `${kind}:${node.id}${suffix}`;

  if (!config.integration || !config.action) {
    errors.push({
      id: at('tool-unset'),
      nodeId: node.id,
      message: `"${name}" has no ${config.integration ? 'action' : 'integration'} selected.`,
    });
    return;
  }
  if (!catalog) return;

  const integration = findIntegration(catalog, config.integration);
  if (!integration) {
    warnings.push({ id: at('tool-unknown'), nodeId: node.id, message: `"${name}" uses unknown integration "${config.integration}".` });
    return;
  }

  const action = (integration.actions || []).find((a) => a.id === config.action);
  // Dynamic integrations (MCP) discover actions per connection, so an action
  // missing from the static list can't be called unknown from here.
  if (!action && !integration.dynamicActions) {
    warnings.push({
      id: at('tool-unknown-action'),
      nodeId: node.id,
      message: `"${name}" uses unknown action "${config.integration}.${config.action}".`,
    });
  }

  for (const field of action?.configSchema || []) {
    const value = config.params?.[field.key] ?? field.default;
    if (field.required && (value === undefined || value === null || String(value).trim() === '')) {
      warnings.push({ id: at('tool-field', `:${field.key}`), nodeId: node.id, message: `"${name}" is missing required field "${field.label}".` });
    }
    if (field.type === 'json' && jsonParamError(value)) {
      warnings.push({ id: at('tool-json', `:${field.key}`), nodeId: node.id, message: `"${name}" has invalid JSON in "${field.label}".` });
    }
    if (looksLikeSecret(value)) {
      warnings.push({
        id: at('tool-secret', `:${field.key}`),
        nodeId: node.id,
        message: `"${name}" has what looks like a token in "${field.label}" — store it in a connection so it's encrypted and redacted.`,
      });
    }
  }

  // spec/37: an MCP node is meaningless without a server to call.
  if (integration.dynamicActions && integration.id === 'mcp') {
    if (validateMcpToolNode(node, config, { connections, errors, warnings, name })) return;
  }

  const { connectionId } = config;
  if (!connectionId) {
    if (needsCredentials(integration)) {
      info.push({ id: at('tool-noconn'), nodeId: node.id, message: `"${name}" runs in sandbox until a connection is selected.` });
    }
    return;
  }
  if (connectionId === 'sandbox' || !connections) return;

  const connection = connections.find((c) => c.id === connectionId || c._id === connectionId);
  if (!connection) {
    warnings.push({ id: at('tool-conn-missing'), nodeId: node.id, message: `"${name}" uses a connection that no longer exists.` });
  } else if (connection.integration !== config.integration) {
    warnings.push({ id: at('tool-conn-mismatch'), nodeId: node.id, message: `"${name}" uses a ${connection.integration} connection for ${integration.name}.` });
  } else if (connection.status === 'error') {
    warnings.push({ id: at('tool-conn-error'), nodeId: node.id, message: `"${name}"'s connection "${connection.name}" failed its last test.` });
  }
}

/**
 * A disabled node (builder "Disable", spec/31 revision) doesn't run - it passes
 * its input through - so its own config problems can't break a run. They're
 * reported as info, prefixed, rather than as errors/warnings: a warning would
 * still block a test run, which is exactly what disabling a broken step is for.
 * Start and End can't be disabled.
 */
function downgradeDisabled(result, nodes) {
  const disabled = new Map(
    nodes
      .filter((n) => n.data?.config?.disabled && n.type !== 'start' && n.type !== 'end')
      .map((n) => [n.id, n.data?.config?.label || n.id]),
  );
  if (!disabled.size) return result;
  const onDisabled = (p) => p.nodeId && disabled.has(p.nodeId);
  const moved = [...result.errors, ...result.warnings]
    .filter(onDisabled)
    .map((p) => ({ ...p, id: `disabled:${p.id}`, message: `(disabled) ${p.message}` }));
  const notes = [...disabled].map(([id, name]) => ({
    id: `node-disabled:${id}`,
    nodeId: id,
    message: `"${name}" is disabled — it passes its input straight through.`,
  }));
  return {
    errors: result.errors.filter((p) => !onDisabled(p)),
    warnings: result.warnings.filter((p) => !onDisabled(p)),
    info: [...result.info, ...moved, ...notes],
  };
}

export function validateGraph(input = {}) {
  return downgradeDisabled(collectProblems(input), input.nodes || []);
}
