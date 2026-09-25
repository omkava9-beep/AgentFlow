import { useCallback, useMemo } from 'react';
import { usePresenceStore, otherPeers, peopleFrom, CURSOR_IDLE_MS } from './presence.js';
import { sendCursor } from './transport.js';

/** Other people on this workflow: per-tab peers, the collapsed people list, and locks. */
export function usePresence() {
  const peers = usePresenceStore((s) => s.peers);
  const selfSocketId = usePresenceStore((s) => s.selfSocketId);
  const locks = usePresenceStore((s) => s.locks);
  const others = useMemo(() => otherPeers({ peers, selfSocketId }), [peers, selfSocketId]);
  const people = useMemo(() => peopleFrom(others), [others]);
  return { others, people, locks, selfSocketId };
}

/**
 * Mouse-move handler for the canvas container that broadcasts the cursor in
 * *flow* coordinates - people have different viewports, so screen pixels would
 * put the cursor somewhere else on everyone else's canvas (spec/28 §4).
 */
export function useCursorBroadcast(containerRef, viewportRef) {
  return useCallback(
    (event) => {
      const el = containerRef.current;
      const vp = viewportRef.current;
      if (!el || !vp) return;
      const rect = el.getBoundingClientRect();
      const x = (event.clientX - rect.left - vp.x) / vp.zoom;
      const y = (event.clientY - rect.top - vp.y) / vp.zoom;
      sendCursor(Math.round(x), Math.round(y));
    },
    [containerRef, viewportRef],
  );
}

/** Whether a peer's cursor is fresh enough to draw. */
export const cursorVisible = (peer, now = Date.now()) =>
  Boolean(peer.cursor) && !peer.away && now - (peer.cursor.at || 0) < CURSOR_IDLE_MS;
