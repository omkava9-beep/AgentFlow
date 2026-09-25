/**
 * Server-side node validation for spec/31, shared by workflow saves (PUT), the
 * collaboration hub's op filter (spec/28) and publish (spec/30).
 *
 * Returns problems rather than throwing, so each caller maps them to its own
 * transport: an HTTP 400/403, a rejected collab op, a publish 422.
 */
import { NODE_TYPES, supportsErrorHandle } from './nodes/index.js';
import { can } from '../tenancy/permissions.js';

/** Structural rules: known node types, and error handles only where supported. → string[] */
export function validateNodeStructure(nodes = [], edges = []) {
  const problems = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const node of nodes) {
    if (!NODE_TYPES.includes(node.type)) problems.push(`Unknown node type "${node.type}" (node ${node.id})`);
  }
  for (const edge of edges) {
    if (edge.sourceHandle !== 'error') continue;
    const source = byId.get(edge.source);
    if (source && !supportsErrorHandle(source.type)) {
      problems.push(`A ${source.type} node can't have an error branch (edge ${edge.id || `${edge.source}->${edge.target}`})`);
    }
  }
  return problems;
}

/**
 * The `code:author` rule (spec/31 §2): adding a Code node, or changing an
 * existing one's source, needs the permission. Editors can still move, rename
 * or delete Code nodes, and run workflows that contain them.
 * → null when allowed, otherwise the reason.
 */
export function checkCodeAuthorship(beforeNodes = [], afterNodes = [], role) {
  if (can(role, 'code:author')) return null;
  const before = new Map(beforeNodes.filter((n) => n.type === 'code').map((n) => [n.id, n]));
  for (const node of afterNodes) {
    if (node.type !== 'code') continue;
    const prior = before.get(node.id);
    const source = node.data?.config?.source ?? '';
    if (!prior) return 'Adding a Code node needs the code:author permission (owner or admin)';
    if ((prior.data?.config?.source ?? '') !== source) {
      return "Editing a Code node's source needs the code:author permission (owner or admin)";
    }
  }
  return null;
}
