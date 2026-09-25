/**
 * Collaboration operations (spec/28 §2) - constructors and a pure `applyOp`.
 *
 * This mirrors the server hub's op set and validation exactly, so the client
 * can apply its own edits optimistically and replay pending ones on top of the
 * server's confirmed document without waiting for a round trip. Ops don't know
 * about node types: `node.update` addresses a path under `data.config`, so new
 * node types (spec/31) and integration fields (spec/26) need nothing here.
 *
 * Wire shape: `{ type, opId, baseSeq, ...payload }`, e.g.
 *   { type: 'node.update', opId, baseSeq, nodeId: 'agent-1', path: ['systemPrompt'], value: '…' }
 *
 * Documents are plain `{ name, nodes: [], edges: [] }` and every apply is
 * immutable - a rejected op leaves the input untouched.
 */

export const OP_TYPES = [
  'node.add', 'node.move', 'node.update', 'node.delete',
  'edge.add', 'edge.update', 'edge.delete',
  'workflow.rename', 'batch',
];

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_PATH = 12;
const MAX_LABEL = 200;

let opCounter = 0;
export function makeOpId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  opCounter += 1;
  return `op-${Date.now().toString(36)}-${opCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export const deepCopy = (value) =>
  value === undefined ? undefined
    : typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function deepEqual(a, b) {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return a === b;
  if (typeof a !== typeof b || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
}

/**
 * Only shared state goes over the wire - and exactly the fields the server
 * stores, so a confirmed copy here is byte-for-byte what the hub holds.
 */
export function cleanNode(node) {
  const data = isPlainObject(node.data) ? deepCopy(node.data) : {};
  if (!isPlainObject(data.config)) data.config = {};
  return { id: node.id, type: node.type, position: { x: node.position?.x || 0, y: node.position?.y || 0 }, data };
}

export function cleanEdge(edge) {
  const out = { id: edge.id, source: edge.source, target: edge.target };
  if (edge.sourceHandle !== undefined && edge.sourceHandle !== null) out.sourceHandle = String(edge.sourceHandle);
  if (edge.label !== undefined && edge.label !== null) out.label = String(edge.label);
  return out;
}

// --- op constructors ---------------------------------------------------------

export const ops = {
  nodeAdd: (node) => ({ type: 'node.add', node: cleanNode(node) }),
  nodeMove: (nodeId, position) => ({ type: 'node.move', nodeId, position: { x: position.x, y: position.y } }),
  nodeUpdate: (nodeId, path, value) => ({ type: 'node.update', nodeId, path, value: deepCopy(value) }),
  nodeDelete: (nodeId) => ({ type: 'node.delete', nodeId }),
  edgeAdd: (edge) => ({ type: 'edge.add', edge: cleanEdge(edge) }),
  edgeUpdate: (edgeId, value) => ({ type: 'edge.update', edgeId, field: 'label', value }),
  edgeDelete: (edgeId) => ({ type: 'edge.delete', edgeId }),
  rename: (name) => ({ type: 'workflow.rename', name }),
  batch: (list) => ({ type: 'batch', ops: list }),
};

/** Wrap a bare op (or batch) with its envelope fields. */
export function envelope(op, baseSeq) {
  return { ...op, opId: makeOpId(), baseSeq };
}

// --- paths -------------------------------------------------------------------

export function validPath(path) {
  return Array.isArray(path) && path.length > 0 && path.length <= MAX_PATH &&
    path.every((seg) => typeof seg === 'string' && seg.length > 0 && !FORBIDDEN_SEGMENTS.has(seg));
}

/** The server refuses to write *under* a non-object (e.g. ['params','x'] when params is a string). */
function writableAt(config, path) {
  let cur = config;
  for (const seg of path.slice(0, -1)) {
    const next = cur[seg];
    if (next === undefined) return true; // intermediate objects are created on the way
    if (!isPlainObject(next)) return false;
    cur = next;
  }
  return true;
}

export function getAtPath(obj, path) {
  let cur = obj;
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Immutable set; `value === undefined` unsets the leaf. Arrays along the path are values, not containers. */
export function setAtPath(obj, path, value) {
  const [head, ...rest] = path;
  const base = isPlainObject(obj) ? obj : {};
  if (!rest.length) {
    const next = { ...base };
    if (value === undefined) delete next[head];
    else next[head] = deepCopy(value);
    return next;
  }
  return { ...base, [head]: setAtPath(base[head], rest, value) };
}

/**
 * The fine-grained edits between two config values, as `{ path, value }`.
 * Plain objects recurse, so two people editing different params fields both
 * survive; arrays and primitives are single values (spec/28: "arrays are values").
 */
export function diffConfig(prev, next, base = []) {
  if (isPlainObject(prev) && isPlainObject(next) && base.length) {
    const out = [];
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for (const key of keys) out.push(...diffConfig(prev[key], next[key], [...base, key]));
    return out;
  }
  if (!base.length) {
    // Top level: always a key-by-key diff of the config object.
    const out = [];
    const p = isPlainObject(prev) ? prev : {};
    const n = isPlainObject(next) ? next : {};
    for (const key of new Set([...Object.keys(p), ...Object.keys(n)])) out.push(...diffConfig(p[key], n[key], [key]));
    return out;
  }
  return deepEqual(prev, next) ? [] : [{ path: base, value: next }];
}

// --- graph rules -------------------------------------------------------------

export function wouldCreateCycle(nodes, edges, source, target) {
  const adjacency = new Map(nodes.map((n) => [n.id, []]));
  edges.forEach((e) => adjacency.get(e.source)?.push(e.target));
  adjacency.get(source)?.push(target);
  const visited = new Set();
  function dfs(id) {
    if (id === source) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return (adjacency.get(id) || []).some(dfs);
  }
  return (adjacency.get(target) || []).some(dfs);
}

/** Condition branches are matched by handle, so their labels aren't free text. */
export const isConditionEdge = (edge) => edge?.sourceHandle === 'true' || edge?.sourceHandle === 'false';

const reject = (reason, message) => ({ ok: false, reason, message });

// --- apply -------------------------------------------------------------------

/**
 * Applies one op to a document. Returns `{ ok: true, doc, cascade? }` or
 * `{ ok: false, reason, message }` with the document untouched. Reasons match
 * the server's: not_found, cycle, duplicate, invalid.
 */
export function applyOp(doc, op) {
  if (!op || typeof op !== 'object') return reject('invalid', 'Malformed op');
  switch (op.type) {
    case 'batch': {
      if (!Array.isArray(op.ops) || !op.ops.length || op.ops.length > 500) return reject('invalid', 'A batch needs 1-500 ops');
      let current = doc;
      const cascade = { edgeIds: [] };
      for (const inner of op.ops) {
        if (inner?.type === 'batch') return reject('invalid', 'Nested batches are not allowed');
        const result = applyOp(current, inner);
        if (!result.ok) return result; // atomic: all or nothing
        current = result.doc;
        if (result.cascade?.edgeIds?.length) cascade.edgeIds.push(...result.cascade.edgeIds);
      }
      return { ok: true, doc: current, ...(cascade.edgeIds.length && { cascade }) };
    }

    case 'node.add': {
      const node = op.node;
      if (!node?.id || !node.type) return reject('invalid', 'A node needs an id and a type');
      if (doc.nodes.some((n) => n.id === node.id)) return reject('duplicate', 'That node already exists');
      if (node.type === 'start' && doc.nodes.some((n) => n.type === 'start')) {
        return reject('invalid', 'A workflow can only have one Start node.');
      }
      return { ok: true, doc: { ...doc, nodes: [...doc.nodes, cleanNode(node)] } };
    }

    case 'node.move': {
      const idx = doc.nodes.findIndex((n) => n.id === op.nodeId);
      if (idx < 0) return reject('not_found', 'That node no longer exists');
      if (!Number.isFinite(op.position?.x) || !Number.isFinite(op.position?.y)) return reject('invalid', 'Bad position');
      const nodes = [...doc.nodes];
      nodes[idx] = { ...nodes[idx], position: { x: op.position.x, y: op.position.y } };
      return { ok: true, doc: { ...doc, nodes } };
    }

    case 'node.update': {
      const idx = doc.nodes.findIndex((n) => n.id === op.nodeId);
      if (idx < 0) return reject('not_found', 'That node no longer exists');
      if (!validPath(op.path)) return reject('invalid', 'Bad path');
      const nodes = [...doc.nodes];
      const node = nodes[idx];
      if (!writableAt(node.data?.config || {}, op.path)) return reject('invalid', "Can't write under a non-object");
      const config = setAtPath(node.data?.config || {}, op.path, op.value);
      nodes[idx] = { ...node, data: { ...node.data, config } };
      return { ok: true, doc: { ...doc, nodes } };
    }

    case 'node.delete': {
      if (!doc.nodes.some((n) => n.id === op.nodeId)) return reject('not_found', 'That node no longer exists');
      const edgeIds = doc.edges.filter((e) => e.source === op.nodeId || e.target === op.nodeId).map((e) => e.id);
      const gone = new Set(edgeIds);
      return {
        ok: true,
        doc: { ...doc, nodes: doc.nodes.filter((n) => n.id !== op.nodeId), edges: doc.edges.filter((e) => !gone.has(e.id)) },
        ...(edgeIds.length && { cascade: { edgeIds } }),
      };
    }

    case 'edge.add': {
      const edge = op.edge;
      if (!edge?.id || !edge.source || !edge.target) return reject('invalid', 'An edge needs an id, source and target');
      if (edge.source === edge.target) return reject('invalid', 'A node cannot connect to itself');
      if (!doc.nodes.some((n) => n.id === edge.source) || !doc.nodes.some((n) => n.id === edge.target)) {
        return reject('not_found', 'One end of that connection no longer exists');
      }
      if (doc.edges.some((e) => e.id === edge.id)) return reject('duplicate', 'That edge already exists');
      if (doc.edges.some((e) => e.source === edge.source && e.target === edge.target && (e.sourceHandle || null) === (edge.sourceHandle || null))) {
        return reject('duplicate', 'Those nodes are already connected');
      }
      if (wouldCreateCycle(doc.nodes, doc.edges, edge.source, edge.target)) {
        return reject('cycle', 'That connection would create a cycle, which is not allowed.');
      }
      return { ok: true, doc: { ...doc, edges: [...doc.edges, cleanEdge(edge)] } };
    }

    case 'edge.update': {
      const idx = doc.edges.findIndex((e) => e.id === op.edgeId);
      if (idx < 0) return reject('not_found', 'That connection no longer exists');
      if (op.field !== 'label') return reject('invalid', 'Only edge labels can be edited');
      const source = doc.nodes.find((n) => n.id === doc.edges[idx].source);
      if (source?.type === 'condition' || isConditionEdge(doc.edges[idx])) return reject('invalid', 'Condition branches are labeled by their handle');
      const edges = [...doc.edges];
      const next = { ...edges[idx] };
      if (op.value === undefined || op.value === null || op.value === '') delete next.label;
      else next.label = String(op.value).slice(0, MAX_LABEL);
      edges[idx] = next;
      return { ok: true, doc: { ...doc, edges } };
    }

    case 'edge.delete': {
      if (!doc.edges.some((e) => e.id === op.edgeId)) return reject('not_found', 'That connection no longer exists');
      return { ok: true, doc: { ...doc, edges: doc.edges.filter((e) => e.id !== op.edgeId) } };
    }

    case 'workflow.rename': {
      // Same as the hub: trimmed, and never empty.
      const name = typeof op.name === 'string' ? op.name.trim() : '';
      if (!name) return reject('invalid', 'A workflow needs a name');
      return { ok: true, doc: { ...doc, name: name.slice(0, MAX_LABEL) } };
    }

    default:
      return reject('invalid', `Unknown op type: ${op.type}`);
  }
}

/** Ops whose pending copies can be merged into one (throttled typing, spec/28 §3). */
export function coalesceIdentity(op) {
  if (op.type === 'node.update') return `nu:${op.nodeId}:${JSON.stringify(op.path)}`;
  if (op.type === 'edge.update') return `eu:${op.edgeId}:${op.field}`;
  if (op.type === 'workflow.rename') return 'rename';
  return null;
}
