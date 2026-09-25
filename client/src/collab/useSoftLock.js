import { useEffect, useState } from 'react';
import { usePresenceStore } from './presence.js';
import { requestLock, releaseLock, heartbeatLock } from './transport.js';

const HEARTBEAT_MS = 15_000;

/**
 * Panels currently mounted per node. A release is deferred a tick and only
 * sent if nothing re-mounted in between - otherwise StrictMode's
 * mount/unmount/mount (or switching panes quickly) would release the lock the
 * second mount just re-took on the same socket.
 */
const mounts = new Map();
function scheduleRelease(nodeId) {
  setTimeout(() => {
    if (!mounts.get(nodeId)) releaseLock(nodeId);
  }, 50);
}

/**
 * Soft lock on a node's configuration (spec/28 §5). Opening the config panel
 * takes the lock; closing it or picking another node releases it. While someone
 * else holds it, the panel is read-only - and the fields keep updating live,
 * because they still render from the store.
 *
 * Returns { status, heldBy, readOnly, released, otherTab, acquire }:
 *   status: 'idle' | 'pending' | 'held' | 'blocked'
 *   released: the holder let go while we were blocked ("Bob finished — Edit now")
 */
export function useSoftLock(nodeId, { enabled = true } = {}) {
  const [state, setState] = useState({ status: 'idle', heldBy: null });
  const [attempt, setAttempt] = useState(0);
  const holder = usePresenceStore((s) => (nodeId ? s.locks[nodeId] : null));
  const selfSocketId = usePresenceStore((s) => s.selfSocketId);
  const selfUserId = usePresenceStore((s) => s.selfUserId);

  useEffect(() => {
    if (!nodeId || !enabled) {
      setState({ status: 'idle', heldBy: null });
      return undefined;
    }
    let cancelled = false;
    let held = false;
    let heartbeat = null;
    mounts.set(nodeId, (mounts.get(nodeId) || 0) + 1);
    setState({ status: 'pending', heldBy: null });

    let tries = 0;
    const attemptLock = () => requestLock(nodeId).then((ack) => {
      if (cancelled) {
        if (ack?.ok && !ack.local) scheduleRelease(nodeId);
        return;
      }
      // A node added a moment ago may not be applied on the server yet (ops
      // are applied through an async chain; lock requests aren't) - retry.
      if (ack?.reason === 'not_found' && tries < 5) {
        tries += 1;
        setTimeout(() => !cancelled && attemptLock(), 250 * tries);
        return;
      }
      if (ack?.reason === 'forbidden' || ack?.reason === 'not_found') {
        setState({ status: 'idle', heldBy: null });
        return;
      }
      if (ack?.ok) {
        held = !ack.local;
        setState({ status: 'held', heldBy: null });
        if (held) heartbeat = setInterval(() => heartbeatLock(nodeId), HEARTBEAT_MS);
      } else if (ack?.error === 'timeout') {
        // Can't reach the server: don't block the user on an unanswerable lock.
        setState({ status: 'held', heldBy: null });
      } else {
        setState({ status: 'blocked', heldBy: ack?.heldBy || null });
      }
    });
    attemptLock();

    return () => {
      cancelled = true;
      if (heartbeat) clearInterval(heartbeat);
      mounts.set(nodeId, (mounts.get(nodeId) || 1) - 1);
      if (held) scheduleRelease(nodeId);
    };
  }, [nodeId, enabled, attempt]);

  const blocked = state.status === 'blocked';
  // The server tells the room when a lock goes (`collab:unlocked`); if the node
  // is no longer locked by anyone else, we can offer to take it.
  const heldByOther = holder && holder.socketId !== selfSocketId;
  const released = blocked && !heldByOther;
  const heldBy = (heldByOther && holder) || state.heldBy;
  const otherTab = blocked && heldBy && (heldBy.sameUser || (selfUserId && String(heldBy.userId) === String(selfUserId)));

  return {
    status: state.status,
    heldBy,
    readOnly: blocked,
    released,
    otherTab: Boolean(otherTab),
    acquire: () => setAttempt((n) => n + 1),
  };
}
