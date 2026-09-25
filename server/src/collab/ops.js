import { findCycle } from '../engine/topologicalOrder.js';
import { normalizeNode } from '../integrations/normalizeToolConfig.js';

/**
 * Collaboration ops (spec/28 §2): validation and application against a session
 * document `{ name, nodes: Map, edges: Map }`.
 *
 * Deliberately node-type agnostic. `node.update` addresses a path under
 * `data.config`, so the node types from spec/31 and the integration fields from
 * spec/26 need nothing here. The one type-aware rule is the `code:author` filter
 * on Code nodes, which spec/31 asks the op layer to enforce.
 *
 * Everything here is synchronous and pure over the document it's given; async
 * checks (connection ownership) happen in the hub before application.
 */

export const OP_TYPES = ['node.add', 'node.move', 'node.update', 'node.delete', 'edge.add', 'edge.update', 'edge.delete', 'workflow.rename', 'batch'];

const MAX_OP_BYTES = 64 * 1024;
export const MAX_DOC_BYTES = 1024 * 1024;
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/** A rejection carries a machine reason (the ack's `reason`) and a human message. */
export class OpRejected extends Error {
  constructor(reason, message, extra = {}) {
    super(message || reason);
    this.reason = reason;
    this.extra = extra;
  }
}

const reject = (reason, message, extra) => { throw new OpRejected(reason, message, extra); };
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? undefined : structuredClone(v));

function assertPosition(position) {
  if (!isObject(position) || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    reject('invalid', 'Position must be { x, y } numbers');
  }
}

function assertPath(path) {
  if (!Array.isArray(path) || !path.length || path.length > 12) reject('invalid', 'path must be a non-empty array');
  for (const seg of path) {
    if (typeof seg !== 'string' || !seg.length || FORBIDDEN_SEGMENTS.has(seg)) reject('invalid', `Invalid path segment: ${String(seg)}`);
  }
}

/** Sets (or, when `unset`, deletes) `path` inside `target`, creating objects on the way. */
function setPath(target, path, value, unset) {
  let cursor = target;
  for (const seg of path.slice(0, -1)) {
    if (cursor[seg] === undefined) {
      if (unset) return;
      cursor[seg] = {};
    } else if (!isObject(cursor[seg])) {
      reject('invalid', `Can't write under a non-object at "${seg}"`);
    }
    cursor = cursor[seg];
  }
  const last = path[path.length - 1];
  if (unset) delete cursor[last];
  else cursor[last] = clone(value);
}

function isCodeSourceEdit(node, path) {
  return node?.type === 'code' && path[0] === 'source';
}

function edgesArray(doc) {
  return [...doc.edges.values()];
}

function nodesArray(doc) {
  return [...doc.nodes.values()];
}

/**
 * Validates and applies one op in place. Returns `{ cascade?, deleted?, restored? }`
 * so the hub can broadcast cascades and fire the spec/29 hooks.
 *
 * `ctx` = { permissions: Set<string>, lockedByOther(nodeId) → holder | null, deletedIds: Set }.
 */
function applyOne(doc, op, ctx) {
  switch (op.type) {
    case 'node.add': {
      const node = op.node;
      if (!isObject(node) || typeof node.id !== 'string' || !node.id || typeof node.type !== 'string' || !node.type) {
        reject('invalid', 'node.add needs { id, type, position, data }');
      }
      assertPosition(node.position);
      if (doc.nodes.has(node.id)) reject('duplicate', `A node with id ${node.id} already exists`);
      if (node.type === 'start' && nodesArray(doc).some((n) => n.type === 'start')) {
        reject('invalid', 'A workflow can only have one Start node');
      }
      if (node.type === 'code' && !ctx.permissions.has('code:author')) {
        reject('forbidden', 'Only owners and admins can add Code nodes');
      }
      const data = isObject(node.data) ? clone(node.data) : {};
      if (!isObject(data.config)) data.config = {};
      // A pasted legacy tool node (spec/26 §6) lands in the new shape.
      const stored = normalizeNode({ id: node.id, type: node.type, position: { x: node.position.x, y: node.position.y }, data });
      doc.nodes.set(node.id, stored);
      return { restored: ctx.deletedIds.has(node.id) ? node.id : null };
    }

    case 'node.move': {
      const node = doc.nodes.get(op.nodeId);
      if (!node) reject('not_found', 'That node no longer exists');
      assertPosition(op.position);
      // Moves are never locked: moving doesn't interfere with configuring.
      node.position = { x: op.position.x, y: op.position.y };
      return {};
    }

    case 'node.update': {
      const node = doc.nodes.get(op.nodeId);
      if (!node) reject('not_found', 'That node no longer exists');
      assertPath(op.path);
      const holder = ctx.lockedByOther(op.nodeId);
      if (holder) reject('locked', `${holder.name || 'Someone'} is editing this node`, { heldBy: { userId: holder.userId, name: holder.name } });
      if (isCodeSourceEdit(node, op.path) && !ctx.permissions.has('code:author')) {
        reject('forbidden', "Only owners and admins can edit a Code node's source");
      }
      if (!isObject(node.data)) node.data = {};
      if (!isObject(node.data.config)) node.data.config = {};
      // Socket.io drops `undefined`, so an absent `value` (or `unset: true`) unsets.
      const unset = op.unset === true || !('value' in op) || op.value === undefined;
      setPath(node.data.config, op.path, op.value, unset);
      return {};
    }

    case 'node.delete': {
      const node = doc.nodes.get(op.nodeId);
      if (!node) reject('not_found', 'That node no longer exists');
      const holder = ctx.lockedByOther(op.nodeId);
      if (holder) reject('locked', `${holder.name || 'Someone'} is editing this node`, { heldBy: { userId: holder.userId, name: holder.name } });
      const edgeIds = [];
      for (const edge of edgesArray(doc)) {
        if (edge.source === op.nodeId || edge.target === op.nodeId) {
          doc.edges.delete(edge.id);
          edgeIds.push(edge.id);
        }
      }
      doc.nodes.delete(op.nodeId);
      return { cascade: { edgeIds }, deleted: { nodeId: op.nodeId, lastKnownNode: node } };
    }

    case 'edge.add': {
      const edge = op.edge;
      if (!isObject(edge) || typeof edge.id !== 'string' || !edge.id || typeof edge.source !== 'string' || typeof edge.target !== 'string') {
        reject('invalid', 'edge.add needs { id, source, target }');
      }
      if (edge.source === edge.target) reject('invalid', "A node can't connect to itself");
      if (!doc.nodes.has(edge.source) || !doc.nodes.has(edge.target)) reject('not_found', 'One end of that connection no longer exists');
      if (doc.edges.has(edge.id)) reject('duplicate', `An edge with id ${edge.id} already exists`);
      const handle = edge.sourceHandle ?? null;
      const same = edgesArray(doc).some((e) => e.source === edge.source && e.target === edge.target && (e.sourceHandle ?? null) === handle);
      if (same) reject('duplicate', 'Those nodes are already connected');
      const stored = { id: edge.id, source: edge.source, target: edge.target };
      if (edge.sourceHandle !== undefined && edge.sourceHandle !== null) stored.sourceHandle = String(edge.sourceHandle);
      if (edge.label !== undefined && edge.label !== null) stored.label = String(edge.label);
      if (findCycle(nodesArray(doc), [...edgesArray(doc), stored])) reject('cycle', 'That connection would create a cycle');
      doc.edges.set(edge.id, stored);
      return {};
    }

    case 'edge.update': {
      const edge = doc.edges.get(op.edgeId);
      if (!edge) reject('not_found', 'That connection no longer exists');
      if (op.field !== 'label') reject('invalid', 'Only an edge label can be updated');
      // Mirrors the store's setEdgeLabel: a condition's branches are named by
      // their handle (true/false), not by a free-text label.
      if (doc.nodes.get(edge.source)?.type === 'condition') reject('invalid', 'Condition branches are labeled by their handle');
      if (op.value === undefined || op.value === null || op.value === '') delete edge.label;
      else edge.label = String(op.value).slice(0, 200);
      return {};
    }

    case 'edge.delete': {
      if (!doc.edges.has(op.edgeId)) reject('not_found', 'That connection no longer exists');
      doc.edges.delete(op.edgeId);
      return {};
    }

    case 'workflow.rename': {
      const name = typeof op.name === 'string' ? op.name.trim() : '';
      if (!name) reject('invalid', 'A workflow needs a name');
      doc.name = name.slice(0, 200);
      return {};
    }

    default:
      return reject('invalid', `Unknown op type: ${op.type}`);
  }
}

/** The ids of tool nodes an op may point at a connection, so the hub can check them async first. */
export function nodesNeedingConnectionCheck(op, doc) {
  const out = [];
  const visit = (o) => {
    if (o?.type === 'batch') return (o.ops || []).forEach(visit);
    if (o?.type === 'node.add' && o.node?.data?.config?.connectionId) out.push({ kind: 'add', node: o.node });
    if (o?.type === 'node.update' && Array.isArray(o.path) && ['connectionId', 'integration'].includes(o.path[0])) {
      const node = doc.nodes.get(o.nodeId);
      if (node) out.push({ kind: 'update', node, path: o.path, value: o.value });
    }
  };
  visit(op);
  return out;
}

export function assertOpShape(op) {
  if (!isObject(op) || !OP_TYPES.includes(op.type)) reject('invalid', 'Unknown op');
  let bytes;
  try {
    bytes = JSON.stringify(op).length;
  } catch {
    reject('invalid', 'Op is not serializable');
  }
  if (bytes > MAX_OP_BYTES) reject('invalid', 'Op is larger than 64 KB');
  if (op.type === 'batch') {
    if (!Array.isArray(op.ops) || !op.ops.length || op.ops.length > 500) reject('invalid', 'batch needs 1-500 ops');
    if (op.ops.some((inner) => !isObject(inner) || inner.type === 'batch' || !OP_TYPES.includes(inner.type))) {
      reject('invalid', 'batch ops must be non-batch ops');
    }
  }
}

function copyDoc(doc) {
  return {
    name: doc.name,
    nodes: new Map([...doc.nodes].map(([id, n]) => [id, structuredClone(n)])),
    edges: new Map([...doc.edges].map(([id, e]) => [id, structuredClone(e)])),
  };
}

export function docSize(doc) {
  return JSON.stringify({ name: doc.name, nodes: nodesArray(doc), edges: edgesArray(doc) }).length;
}

/**
 * Applies an op (or an atomic batch) to `doc`. On any rejection nothing is
 * applied: batches run on a copy that replaces the original only on success.
 * Returns `{ doc, cascade, deleted[], restored[] }`.
 */
export function applyOp(doc, op, ctx) {
  assertOpShape(op);
  const effects = { cascade: { edgeIds: [] }, deleted: [], restored: [] };
  const ops = op.type === 'batch' ? op.ops : [op];

  // Always work on a copy: a batch that fails on its third op, or any op that
  // pushes the document past 1 MB, must leave the session exactly as it was.
  // Copying a workflow-sized graph per op is cheap at this scale.
  const target = copyDoc(doc);
  for (const inner of ops) {
    const result = applyOne(target, inner, ctx);
    if (result.cascade) effects.cascade.edgeIds.push(...result.cascade.edgeIds);
    if (result.deleted) effects.deleted.push(result.deleted);
    if (result.restored) effects.restored.push(result.restored);
  }
  if (docSize(target) > MAX_DOC_BYTES) reject('invalid', 'The workflow would be larger than 1 MB');

  doc.name = target.name;
  doc.nodes = target.nodes;
  doc.edges = target.edges;
  return effects;
}

export function docFromWorkflow(workflow) {
  return {
    name: workflow.name,
    nodes: new Map((workflow.nodes || []).map((n) => [n.id, structuredClone(plain(n))])),
    edges: new Map((workflow.edges || []).map((e) => [e.id, structuredClone(plain(e))])),
  };
}

export function docToPlain(doc) {
  return { name: doc.name, nodes: nodesArray(doc).map(clone), edges: edgesArray(doc).map(clone) };
}

/** Mongoose subdocuments → plain objects without undefined fields. */
function plain(value) {
  const obj = value?.toObject ? value.toObject() : value;
  return JSON.parse(JSON.stringify(obj ?? null));
}
