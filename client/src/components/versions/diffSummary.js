/** "+2 nodes, 1 changed, 1 edge removed" from a spec/30 diff object. */
export function summarizeDiff(diff) {
  if (!diff) return '';
  const parts = [];
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const { nodes = {}, edges = {} } = diff;
  if (nodes.added?.length) parts.push(`+${plural(nodes.added.length, 'node')}`);
  if (nodes.removed?.length) parts.push(`−${plural(nodes.removed.length, 'node')}`);
  if (nodes.changed?.length) parts.push(`${nodes.changed.length} changed`);
  if (edges.added?.length) parts.push(`+${plural(edges.added.length, 'edge')}`);
  if (edges.removed?.length) parts.push(`${plural(edges.removed.length, 'edge')} removed`);
  if (edges.changed?.length) parts.push(`${plural(edges.changed.length, 'edge')} changed`);
  if (diff.nameChanged) parts.push('renamed');
  if (!parts.length && nodes.moved?.length) parts.push(`layout only (${plural(nodes.moved.length, 'node')} moved)`);
  return parts.join(', ') || 'no changes';
}
