/**
 * spec/37's validation rules, called from validateGraph: MCP tool nodes and an
 * agent's tool list. Pure, like the rest of the validator. Tools are resolved
 * from a connection's saved `toolsSnapshot`, so nothing here needs a network
 * call — when no snapshot is available the "no longer offered" check is skipped
 * rather than guessed.
 */
import { findIntegration } from './integrationCatalog.js';
import { snapshotTools, actionHasSideEffect, toolToAction, MAX_AGENT_TOOLS } from './mcpSchema.js';

const findConnection = (connections, id) => (connections || []).find((c) => c.id === id || c._id === id) || null;

/** The MCP tool node rules. Returns true when the generic connection checks should be skipped. */
export function validateMcpToolNode(node, config, { connections, errors, warnings, name }) {
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
    warnings.push({
      id: at('mcp-tool-gone'),
      nodeId: node.id,
      message: `Tool "${config.action}" is no longer offered by ${connection.name}.`,
    });
  }
  return false;
}

/** An agent's `tools` list (spec/37 §5). */
export function validateAgentTools(node, { catalog, connections, errors, warnings, name }) {
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
      if (tool && actionHasSideEffect(toolToAction(tool))) sideEffects += 1;
      return;
    }
    if (!catalog) return;
    const integration = findIntegration(catalog, entry.integration);
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
    errors.push({
      id: at('agent-side-effects'),
      nodeId: node.id,
      message: `"${name}" has side-effecting tools but side effects aren't allowed.`,
    });
  }
}
