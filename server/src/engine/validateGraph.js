/**
 * Server port of client/src/utils/validateGraph.js (+ validateAdvancedNodes.js)
 * for publishing (spec/30 §3): the client's check is a convenience, but a
 * publish must be refused by the server no matter what sent it.
 *
 * The two copies are kept in step by one fixture set,
 * `validationFixtures.json` next to this file, which `check:versions` runs
 * here and `check:logic` runs against the client copy. Change a rule in one
 * copy → change it in the other and add a fixture.
 *
 * Same contract as the client: `{ errors, warnings, info }`, where an error
 * means "not a workflow at all" (publish refused), a warning means "valid shape,
 * won't run correctly" (publish needs acknowledgement), and info never blocks.
 */
import { normalizeToolConfig } from '../integrations/normalizeToolConfig.js';

export const ERROR_HANDLE_TYPES = ['agent', 'tool', 'code', 'subworkflow', 'loop'];
export const MAX_DELAY_MS = 24 * 60 * 60 * 1000;
export const MAX_AGENT_TOOLS = 20;

const TOKEN_PATTERNS = [/xoxb-/, /ghp_/, /github_pat_/, /sk_live_/, /sk_test_/, /^Bearer\s+\S+/i];
const looksLikeSecret = (value) => typeof value === 'string' && TOKEN_PATTERNS.some((re) => re.test(value.trim()));
const needsCredentials = (integration) => Boolean(integration) && integration.auth?.type !== 'none';

function jsonParamError(text) {
  if (text === undefined || text === null || String(text).trim() === '') return null;
  if (typeof text !== 'string') return null;
  try {
    JSON.parse(text.replace(/\{\{[^}]*\}\}/g, '0'));
    return null;
  } catch (err) {
    return `Invalid JSON: ${err.message}`;
  }
}

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

function parses(args, body) {
  try {
    // eslint-disable-next-line no-new-func
    new Function(...args, body);
    return true;
  } catch {
    return false;
  }
}
const expressionParses = (expression) => parses(['output'], `"use strict"; return Boolean(${expression});`);

const sameSet = (a, b) => {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

function collectProblems({ nodes = [], edges = [], integrations = null, connections = null, workflows = null, currentWorkflowId = null }) {
  const errors = [];
  const warnings = [];
  const info = [];
  const label = (n) => n.data?.config?.label || n.id;

  if (!nodes.length) {
    errors.push({ id: 'empty', message: 'The canvas is empty — add a node to get started.' });
    return { errors, warnings, info };
  }

  const startNodes = nodes.filter((n) => n.type === 'start');
  if (!startNodes.length) errors.push({ id: 'no-start', message: 'Workflow needs a Start node.' });
  if (hasCycle(nodes, edges)) errors.push({ id: 'cycle', message: 'The graph contains a cycle — execution would never finish.' });

  const endNodes = nodes.filter((n) => n.type === 'end');
  if (!endNodes.length) warnings.push({ id: 'no-end', message: 'No End node — the workflow has no defined result.' });
  else if (endNodes.length > 1) warnings.push({ id: 'many-end', message: `${endNodes.length} End nodes — only one is meaningful.` });

  const outgoing = (id) => edges.filter((e) => e.source === id);

  for (const node of nodes) {
    if (node.type === 'tool') validateToolNode(node, { catalog: integrations, connections, errors, warnings, info, label });

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
        warnings.push({ id: `cond-branch:${node.id}`, nodeId: node.id, message: `"${label(node)}" has no ${missing.join(' or ')} branch — that path dead-ends.` });
      }
    }

    // spec/37: MCP tools and integration actions an agent may call.
    if (node.type === 'agent') validateAgentTools(node, { catalog: integrations, connections, errors, warnings, name: label(node) });

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

function validateToolNode(node, { catalog, connections, errors, warnings, info, label }) {
  const config = normalizeToolConfig(node.data?.config || {}) || {};
  const name = label(node);
  const at = (kind, suffix = '') => `${kind}:${node.id}${suffix}`;

  if (!config.integration || !config.action) {
    errors.push({ id: at('tool-unset'), nodeId: node.id, message: `"${name}" has no ${config.integration ? 'action' : 'integration'} selected.` });
    return;
  }
  if (!catalog) return;

  const integration = catalog.find((i) => i.id === config.integration);
  if (!integration) {
    warnings.push({ id: at('tool-unknown'), nodeId: node.id, message: `"${name}" uses unknown integration "${config.integration}".` });
    return;
  }

  const action = (integration.actions || []).find((a) => a.id === config.action);
  if (!action && !integration.dynamicActions) {
    warnings.push({ id: at('tool-unknown-action'), nodeId: node.id, message: `"${name}" uses unknown action "${config.integration}.${config.action}".` });
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

  const connection = connections.find((c) => String(c.id || c._id) === String(connectionId));
  if (!connection) {
    warnings.push({ id: at('tool-conn-missing'), nodeId: node.id, message: `"${name}" uses a connection that no longer exists.` });
  } else if (connection.integration !== config.integration) {
    warnings.push({ id: at('tool-conn-mismatch'), nodeId: node.id, message: `"${name}" uses a ${connection.integration} connection for ${integration.name}.` });
  } else if (connection.status === 'error') {
    warnings.push({ id: at('tool-conn-error'), nodeId: node.id, message: `"${name}"'s connection "${connection.name}" failed its last test.` });
  }
}

function validateAdvanced({ nodes, edges, workflows, currentWorkflowId, errors, warnings, label }) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = (id) => edges.filter((e) => e.target === id);

  for (const edge of edges) {
    if (edge.sourceHandle !== 'error') continue;
    const source = byId.get(edge.source);
    if (source && !ERROR_HANDLE_TYPES.includes(source.type)) {
      errors.push({
        id: `error-edge:${edge.id || `${edge.source}-${edge.target}`}`,
        nodeId: source.id,
        message: `"${label(source)}" (${source.type}) can't have an error branch.`,
      });
    }
  }

  for (const node of nodes) {
    const config = node.data?.config || {};
    const name = label(node);
    const warn = (kind, message) => warnings.push({ id: `${kind}:${node.id}`, nodeId: node.id, message });

    if (node.type === 'transform') {
      const keys = (config.mappings || []).map((m) => String(m.key || '').trim());
      if (!keys.length) warn('transform-empty', `"${name}" has no mappings.`);
      else if (keys.some((k) => !k)) warn('transform-key', `"${name}" has a mapping with no key.`);
      else if (new Set(keys).size !== keys.length) warn('transform-dup', `"${name}" maps the same key twice.`);
    }

    // spec/32: an approval routes by its two handles; one left unwired means that
    // outcome silently ends the branch. minApprovals must be a positive count.
    if (node.type === 'approval') {
      const out = edges.filter((e) => e.source === node.id);
      for (const handle of ['approved', 'rejected']) {
        if (!out.some((e) => e.sourceHandle === handle)) {
          warn(`approval-${handle}`, `"${name}" has nothing connected to its ${handle} branch.`);
        }
      }
      const min = Number(config.minApprovals ?? 1);
      const listed = (config.assignees?.userIds || []).length;
      if (!Number.isInteger(min) || min < 1) warn('approval-min', `"${name}" needs at least 1 approval.`);
      else if (listed && !(config.assignees?.roles || []).length && min > listed) {
        warn('approval-min-size', `"${name}" needs ${min} approvals but only ${listed} people are assigned.`);
      }
      if (config.timeout && !(Number(config.timeout.afterMs) > 0)) warn('approval-timeout', `"${name}" has a timeout with no duration.`);
    }

    if (node.type === 'code') {
      const source = String(config.source || '');
      if (!source.trim()) warn('code-empty', `"${name}" has no source.`);
      else if (!parses(['input'], source)) warn('code-invalid', `"${name}" has source that doesn't parse.`);
    }

    if (node.type === 'delay') {
      if ((config.mode || 'duration') === 'duration') {
        const ms = Number(config.durationMs);
        if (!ms || ms <= 0) warn('delay-zero', `"${name}" waits for zero time.`);
        else if (ms > MAX_DELAY_MS) warn('delay-long', `"${name}" waits longer than 24 h (the maximum).`);
      } else if (!String(config.until || '').trim()) {
        warn('delay-until', `"${name}" has no "until" date.`);
      }
    }

    if (node.type === 'loop' || node.type === 'subworkflow') {
      const what = node.type === 'loop' ? 'body workflow' : 'workflow';
      const target = workflows?.find((w) => String(w._id || w.id) === String(config.workflowId));
      if (!config.workflowId) warn(`${node.type}-unset`, `"${name}" has no ${what} selected.`);
      else if (currentWorkflowId && String(config.workflowId) === String(currentWorkflowId)) {
        warn(`${node.type}-self`, `"${name}" calls this workflow itself — recursion is limited to depth 5.`);
      } else if (workflows && !target) {
        warn(`${node.type}-missing`, `"${name}" points at a ${what} that no longer exists.`);
      } else if (target && target.publishedVersion === null) {
        // spec/30: children run their published version, so an unpublished
        // child would fail at run time.
        warn(`${node.type}-unpublished`, `"${name}" points at a ${what} that has never been published.`);
      }
    }

    if (node.type === 'loop') {
      const c = Number(config.concurrency ?? 3);
      if (!(c >= 1 && c <= 10)) warn('loop-concurrency', `"${name}" concurrency must be between 1 and 10.`);
      if (!String(config.itemsPath || '').trim()) warn('loop-items', `"${name}" has no items template.`);
    }

    if (node.type === 'merge' && incoming(node.id).length < 2) {
      warn('merge-inputs', `"${name}" has fewer than two incoming branches — nothing to merge.`);
    }
  }
}

// ------------------------------------------------------------------ spec/37 (mirrors client/src/utils/validateMcp.js)

const findConnection = (connections, id) => (connections || []).find((c) => String(c.id || c._id) === String(id)) || null;
const snapshotTools = (connection) => connection?.config?.toolsSnapshot?.tools || null;
const toolHasSideEffect = (tool) => tool?.annotations?.readOnlyHint !== true;
function actionHasSideEffect(action) {
  if (!action) return false;
  if (action.sideEffect !== undefined) return Boolean(action.sideEffect);
  return action.annotations ? action.annotations.readOnlyHint !== true : false;
}

/** The MCP tool node rules. Returns true when the generic connection checks should be skipped. */
function validateMcpToolNode(node, config, { connections, errors, warnings, name }) {
  const at = (kind) => `${kind}:${node.id}`;
  const { connectionId } = config;
  if (!connectionId || connectionId === 'sandbox') {
    errors.push({ id: at('mcp-noconn'), nodeId: node.id, message: `"${name}" needs an MCP connection to know which server to call.` });
    return true;
  }
  if (!connections) return true;
  const connection = findConnection(connections, connectionId);
  if (!connection) {
    errors.push({ id: at('mcp-conn-missing'), nodeId: node.id, message: `"${name}": connection missing or deleted.` });
    return true;
  }
  const tools = snapshotTools(connection);
  if (tools && !tools.some((t) => t.name === config.action)) {
    warnings.push({ id: at('mcp-tool-gone'), nodeId: node.id, message: `Tool "${config.action}" is no longer offered by ${connection.name}.` });
  }
  return false;
}

/** An agent's `tools` list (spec/37 §5). */
function validateAgentTools(node, { catalog, connections, errors, warnings, name }) {
  const config = node.data?.config || {};
  const tools = config.tools || [];
  if (!tools.length) return;
  const at = (kind, i = '') => `${kind}:${node.id}${i === '' ? '' : `:${i}`}`;

  if (tools.length > MAX_AGENT_TOOLS) {
    errors.push({ id: at('agent-tools-max'), nodeId: node.id, message: `"${name}" has ${tools.length} tools — the limit is ${MAX_AGENT_TOOLS}.` });
  }

  let sideEffects = 0;
  tools.forEach((entry, i) => {
    if (entry.integration === 'mcp') {
      const connection = connections ? findConnection(connections, entry.connectionId) : undefined;
      if (!entry.connectionId || (connections && !connection)) {
        warnings.push({ id: at('agent-tool-conn', i), nodeId: node.id, message: `"${name}" has a tool whose connection is missing or deleted (${entry.action}).` });
        return;
      }
      const snap = snapshotTools(connection);
      const tool = snap?.find((t) => t.name === entry.action);
      if (snap && !tool) {
        warnings.push({ id: at('agent-tool-gone', i), nodeId: node.id, message: `"${name}": tool "${entry.action}" is no longer offered by ${connection.name}.` });
        return;
      }
      if (tool && toolHasSideEffect(tool)) sideEffects += 1;
      return;
    }
    if (!catalog) return;
    const integration = catalog.find((c) => c.id === entry.integration);
    const action = integration?.actions?.find((a) => a.id === entry.action);
    if (!action) {
      warnings.push({ id: at('agent-tool-unknown', i), nodeId: node.id, message: `"${name}" uses unknown tool "${entry.integration}.${entry.action}".` });
      return;
    }
    if (entry.connectionId && entry.connectionId !== 'sandbox' && connections && !findConnection(connections, entry.connectionId)) {
      warnings.push({ id: at('agent-tool-conn', i), nodeId: node.id, message: `"${name}" has a tool whose connection is missing or deleted (${action.name}).` });
    }
    if (actionHasSideEffect(action)) sideEffects += 1;
  });

  if (sideEffects && !config.allowSideEffects) {
    errors.push({ id: at('agent-side-effects'), nodeId: node.id, message: `"${name}" has side-effecting tools but side effects aren't allowed.` });
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
