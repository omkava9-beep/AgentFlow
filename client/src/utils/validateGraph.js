/**
 * Standing validation for the builder canvas (spec/20).
 *
 * The error/warning split is the point: an **error** means the graph is not a
 * workflow at all (so saving is blocked), while a **warning** means it's a valid
 * shape that won't execute correctly yet (so saving is fine, running is not).
 * Phase 1 blocked *saving* on a missing Start node, which meant an in-progress
 * graph couldn't be parked.
 */

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

export function validateGraph({ nodes = [], edges = [], tools = null }) {
  const errors = [];
  const warnings = [];
  const label = (n) => n.data?.config?.label || n.id;

  if (!nodes.length) {
    errors.push({ id: 'empty', message: 'The canvas is empty — add a node to get started.' });
    return { errors, warnings };
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
    if (node.type === 'tool') {
      const { toolType, toolConfig } = node.data?.config || {};
      const tool = tools?.find((t) => t.type === toolType);

      if (!toolType) {
        warnings.push({ id: `tool-unset:${node.id}`, nodeId: node.id, message: `"${label(node)}" has no tool type selected.` });
      } else if (tools && !tool) {
        warnings.push({ id: `tool-unknown:${node.id}`, nodeId: node.id, message: `"${label(node)}" uses unknown tool type "${toolType}".` });
      } else if (tool) {
        // A required field left blank fails the node at run time, so say so now.
        for (const field of tool.configSchema || []) {
          const value = toolConfig?.[field.key] ?? field.default;
          if (field.required && (value === undefined || value === null || String(value).trim() === '')) {
            warnings.push({
              id: `tool-field:${node.id}:${field.key}`,
              nodeId: node.id,
              message: `"${label(node)}" is missing required field "${field.label}".`,
            });
          }
        }
      }
    }

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

  if (startNodes.length) {
    const reachable = reachableFrom(startNodes[0].id, nodes, edges);
    for (const node of nodes) {
      if (!reachable.has(node.id)) {
        warnings.push({ id: `unreachable:${node.id}`, nodeId: node.id, message: `"${label(node)}" is unreachable from Start.` });
      }
    }
  }

  return { errors, warnings };
}
