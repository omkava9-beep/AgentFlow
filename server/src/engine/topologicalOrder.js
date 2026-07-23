/** Returns node ids in an order where every node comes after all its dependencies. */
export function topologicalOrder(nodes, edges) {
  const incoming = new Map(nodes.map((n) => [n.id, 0]));
  const adjacency = new Map(nodes.map((n) => [n.id, []]));

  for (const edge of edges) {
    if (!adjacency.has(edge.source) || !incoming.has(edge.target)) continue;
    adjacency.get(edge.source).push(edge.target);
    incoming.set(edge.target, incoming.get(edge.target) + 1);
  }

  const queue = nodes.filter((n) => incoming.get(n.id) === 0).map((n) => n.id);
  const order = [];
  const remainingIncoming = new Map(incoming);

  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const next of adjacency.get(id) || []) {
      remainingIncoming.set(next, remainingIncoming.get(next) - 1);
      if (remainingIncoming.get(next) === 0) queue.push(next);
    }
  }

  return order;
}

export function findCycle(nodes, edges) {
  const adjacency = new Map(nodes.map((n) => [n.id, []]));
  for (const edge of edges) {
    if (adjacency.has(edge.source)) adjacency.get(edge.source).push(edge.target);
  }
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
