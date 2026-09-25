/**
 * Canvas geometry with no React and no dependencies, so check:logic can test it:
 * auto-layout (left → right, layered), align and distribute. Every function
 * returns `{ [nodeId]: { x, y } }` for the nodes it moved; the store turns that
 * into one batch of node.move ops (one undo step, synced to collaborators).
 */

export const DEFAULT_SIZE = { width: 248, height: 80 };
const sizeOf = (n) => ({ width: n.width || DEFAULT_SIZE.width, height: n.height || DEFAULT_SIZE.height });

/** Where a branch sorts among its siblings: positive first, error always last. */
function handleRank(edge, sourceNode) {
  const h = edge.sourceHandle;
  if (h === 'error') return 1000;
  if (h === 'true' || h === 'approved') return 0;
  if (h === 'false' || h === 'rejected') return 1;
  const candidates = sourceNode?.data?.config?.candidates;
  if (sourceNode?.data?.config?.isHandoff && Array.isArray(candidates)) {
    const i = candidates.indexOf(edge.label);
    if (i >= 0) return 10 + i;
  }
  return 5;
}

/**
 * Layered left-to-right layout (a small Sugiyama-style pass):
 * 1. rank = longest path from a root, so every edge points right;
 * 2. order within a rank by the parents' order (barycenter), with each node's
 *    children in branch order (true/approved above false/rejected, handoff
 *    candidates in list order, error branches below everything);
 * 3. place ranks as columns and centre each column vertically.
 * Nodes that aren't connected to anything go in a row underneath.
 */
export function autoLayout(nodes, edges, { gapX = 90, gapY = 44, origin = null } = {}) {
  if (!nodes.length) return {};
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const valid = edges.filter((e) => byId.has(e.source) && byId.has(e.target) && e.source !== e.target);
  const outgoing = new Map(nodes.map((n) => [n.id, []]));
  const indegree = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of valid) {
    outgoing.get(e.source).push(e);
    indegree.set(e.target, indegree.get(e.target) + 1);
  }
  const connected = new Set(valid.flatMap((e) => [e.source, e.target]));

  // Kahn's order doubles as a cycle guard: a node never reached keeps rank 0.
  const rank = new Map(nodes.map((n) => [n.id, 0]));
  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  // Start first, then by current x so a hand-arranged canvas keeps its sense.
  queue.sort((a, b) => (byId.get(a).type === 'start' ? -1 : 0) - (byId.get(b).type === 'start' ? -1 : 0) || byId.get(a).position.x - byId.get(b).position.x);
  const remaining = new Map(indegree);
  const topo = [];
  while (queue.length) {
    const id = queue.shift();
    topo.push(id);
    for (const e of outgoing.get(id)) {
      rank.set(e.target, Math.max(rank.get(e.target), rank.get(id) + 1));
      remaining.set(e.target, remaining.get(e.target) - 1);
      if (remaining.get(e.target) === 0) queue.push(e.target);
    }
  }
  for (const n of nodes) if (!topo.includes(n.id)) topo.push(n.id);

  const layers = [];
  for (const id of topo) {
    if (!connected.has(id)) continue;
    const r = rank.get(id);
    (layers[r] ||= []).push(id);
  }

  // Order: rank 0 as found; each later rank by the (branch-weighted) position
  // of its parents in the previous ranks.
  const orderIndex = new Map();
  const incoming = new Map(nodes.map((n) => [n.id, []]));
  for (const e of valid) incoming.get(e.target).push(e);
  layers.forEach((layer, r) => {
    if (r === 0) {
      layer.sort((a, b) => byId.get(a).position.y - byId.get(b).position.y);
    } else {
      const key = (id) => {
        const parents = incoming.get(id).filter((e) => orderIndex.has(e.source));
        if (!parents.length) return byId.get(id).position.y / 1000;
        return parents.reduce((sum, e) => sum + orderIndex.get(e.source) + handleRank(e, byId.get(e.source)) / 100, 0) / parents.length;
      };
      layer.sort((a, b) => key(a) - key(b));
    }
    layer.forEach((id, i) => orderIndex.set(id, i));
  });

  const columnWidth = (layer) => Math.max(...layer.map((id) => sizeOf(byId.get(id)).width));
  const columnHeight = (layer) => layer.reduce((h, id) => h + sizeOf(byId.get(id)).height, 0) + gapY * (layer.length - 1);
  const tallest = Math.max(0, ...layers.filter(Boolean).map(columnHeight));

  const anchor = origin || {
    x: Math.min(...nodes.map((n) => n.position.x)),
    y: Math.min(...nodes.map((n) => n.position.y)),
  };
  const out = {};
  let x = anchor.x;
  for (const layer of layers) {
    if (!layer) continue;
    let y = anchor.y + (tallest - columnHeight(layer)) / 2;
    for (const id of layer) {
      out[id] = { x: Math.round(x), y: Math.round(y) };
      y += sizeOf(byId.get(id)).height + gapY;
    }
    x += columnWidth(layer) + gapX;
  }

  // Loose nodes: a row under the graph, in their current left-to-right order.
  const loose = nodes.filter((n) => !connected.has(n.id)).sort((a, b) => a.position.x - b.position.x);
  let lx = anchor.x;
  const ly = anchor.y + (layers.length ? tallest + gapY * 2 : 0);
  for (const n of loose) {
    out[n.id] = { x: Math.round(lx), y: Math.round(ly) };
    lx += sizeOf(n).width + gapX / 2;
  }
  return out;
}

/** Align the given nodes' edges or centres: left | center | right | top | middle | bottom. */
export function alignNodes(nodes, mode) {
  if (nodes.length < 2) return {};
  const boxes = nodes.map((n) => ({ n, ...sizeOf(n) }));
  const left = Math.min(...boxes.map((b) => b.n.position.x));
  const right = Math.max(...boxes.map((b) => b.n.position.x + b.width));
  const top = Math.min(...boxes.map((b) => b.n.position.y));
  const bottom = Math.max(...boxes.map((b) => b.n.position.y + b.height));
  const out = {};
  for (const { n, width, height } of boxes) {
    const p = { ...n.position };
    if (mode === 'left') p.x = left;
    else if (mode === 'right') p.x = right - width;
    else if (mode === 'center') p.x = (left + right) / 2 - width / 2;
    else if (mode === 'top') p.y = top;
    else if (mode === 'bottom') p.y = bottom - height;
    else if (mode === 'middle') p.y = (top + bottom) / 2 - height / 2;
    out[n.id] = { x: Math.round(p.x), y: Math.round(p.y) };
  }
  return out;
}

/** Even gaps between the given nodes along `axis` ('horizontal' | 'vertical'); the outermost two stay put. */
export function distributeNodes(nodes, axis) {
  if (nodes.length < 3) return {};
  const horizontal = axis === 'horizontal';
  const pos = (n) => (horizontal ? n.position.x : n.position.y);
  const len = (n) => (horizontal ? sizeOf(n).width : sizeOf(n).height);
  const sorted = [...nodes].sort((a, b) => pos(a) - pos(b));
  const start = pos(sorted[0]);
  const end = pos(sorted[sorted.length - 1]) + len(sorted[sorted.length - 1]);
  const total = sorted.reduce((sum, n) => sum + len(n), 0);
  const gap = (end - start - total) / (sorted.length - 1);
  const out = {};
  let cursor = start;
  for (const n of sorted) {
    out[n.id] = horizontal ? { x: Math.round(cursor), y: Math.round(n.position.y) } : { x: Math.round(n.position.x), y: Math.round(cursor) };
    cursor += len(n) + gap;
  }
  return out;
}

/** Where a node inserted on an edge goes: halfway along it, centred on the line. */
export function edgeMidpoint(edge, nodesById) {
  const s = nodesById.get(edge.source);
  const t = nodesById.get(edge.target);
  if (!s || !t) return { x: 0, y: 0 };
  const ss = sizeOf(s);
  const ts = sizeOf(t);
  return {
    x: Math.round((s.position.x + ss.width + t.position.x) / 2 - DEFAULT_SIZE.width / 2),
    y: Math.round((s.position.y + ss.height / 2 + t.position.y + ts.height / 2) / 2 - DEFAULT_SIZE.height / 2),
  };
}

/** True when two node boxes overlap (auto-layout's own acceptance test). */
export function overlaps(a, b, pa = a.position, pb = b.position) {
  const sa = sizeOf(a);
  const sb = sizeOf(b);
  return pa.x < pb.x + sb.width && pb.x < pa.x + sa.width && pa.y < pb.y + sb.height && pb.y < pa.y + sa.height;
}
