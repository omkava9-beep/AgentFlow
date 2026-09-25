// Frames a read-only graph so it stays legible: a small graph is centred at
// up to 100%; a big one opens at a readable zoom anchored on the left (where
// the trigger is) and the viewer pans, instead of shrinking it to a thumbnail.
export function frameReadable(instance, el, { minZoom = 0.75, maxZoom = 1, pad = 24 } = {}) {
  const measured = instance.getNodes();
  if (!el || !measured.length) return;
  const minX = Math.min(...measured.map((n) => n.position.x));
  const maxX = Math.max(...measured.map((n) => n.position.x + (n.width || 248)));
  const minY = Math.min(...measured.map((n) => n.position.y));
  const maxY = Math.max(...measured.map((n) => n.position.y + (n.height || 56)));
  const { clientWidth: w, clientHeight: h } = el;
  const fit = Math.min((w - pad * 2) / (maxX - minX || 1), (h - pad * 2) / (maxY - minY || 1), maxZoom);
  const zoom = Math.max(fit, minZoom);
  const graphW = (maxX - minX) * zoom;
  const graphH = (maxY - minY) * zoom;
  const x = graphW <= w - pad * 2 ? (w - graphW) / 2 - minX * zoom : pad - minX * zoom;
  // Tall graphs start near the top rather than cutting both ends.
  const y = graphH <= h - pad * 2 ? h / 2 - ((minY + maxY) / 2) * zoom : pad - minY * zoom;
  instance.setViewport({ x, y, zoom });
}

/** onInit handler: waits for React Flow to measure nodes, then frames them. */
export function frameOnInit(getEl, options) {
  return (instance) => requestAnimationFrame(() => requestAnimationFrame(() => frameReadable(instance, getEl(), options)));
}
