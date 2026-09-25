import { getSocket } from '../realtime/socket.js';
import { useWorkflowStore, getOpClient, collabHooks, bindTransport } from '../store/workflowStore.js';
import { usePresenceStore, throttle } from './presence.js';
import { useToastStore } from '../store/toastStore.js';
import { updateWorkflow, getWorkflow } from '../api/workflows.js';

/**
 * Binds the workflow store's OpClient to the session socket (spec/28 §7).
 *
 * - `workflow:subscribe { workflowId, sinceSeq, sessionId }` → a snapshot on
 *   first join, or a catch-up of the ops we missed on reconnect.
 * - Every local op goes out as `collab:op` and comes back acked or rejected.
 * - A gap in seq, an ack timeout or a reconnect resubscribes; pending ops are
 *   resent and the server dedupes them by opId.
 *
 * A server without the collaboration hub (its subscribe ack carries no
 * snapshot) is handled as a fallback: edits save with a debounced whole-document
 * PUT. That keeps the builder usable against older servers and in partial
 * deployments; with the hub present it is never used.
 */

const ACK_TIMEOUT_MS = 10_000;
const REST_DEBOUNCE_MS = 800;
const RETRY_MS = 2000;
const PRESENCE_MS = 50; // 20 per second (spec/28 §4)

let session = null;

const toast = (message, tone = 'info') => useToastStore.getState().push(message, tone);
const store = () => useWorkflowStore.getState();
const presence = () => usePresenceStore.getState();

export function getSession() {
  return session;
}

/**
 * Opens the live session for one workflow. Returns a function that closes it.
 * `onClosed({ reason, by })` fires when the workflow is deleted under us.
 */
export function openWorkflowSession(workflowId, { userId, onClosed } = {}) {
  closeWorkflowSession();
  const socket = getSocket();
  if (!socket || !workflowId) return () => {};

  const s = {
    workflowId,
    socket,
    mode: 'connecting', // 'collab' | 'rest'
    closed: false,
    resyncing: false,
    offs: [],
    restTimer: null,
    restInFlight: false,
    hadSession: false,
    lastSelection: '',
  };
  session = s;

  const client = () => getOpClient();

  // --- ops out ---------------------------------------------------------------
  const send = (op) => {
    const sender = client();
    socket.timeout(ACK_TIMEOUT_MS).emit('collab:op', { workflowId, op }, (err, ack) => {
      if (s.closed || client() !== sender) return;
      // No ack in time while still connected: resync, which resends whatever
      // is unconfirmed (the server acks a duplicate opId with its original seq).
      if (err) return resync('ack-timeout');
      sender.ack(op.opId, ack);
    });
  };
  const unbind = bindTransport({
    send,
    onGap: () => resync('gap'),
    onClientReplaced: () => {
      if (s.mode === 'rest') return;
      s.resyncing = false;
      subscribe({ forceSnapshot: true });
    },
  });

  // --- joining and catching up ----------------------------------------------
  function subscribe({ forceSnapshot = false } = {}) {
    if (s.closed || !socket.connected) return;
    const c = client();
    const payload = { workflowId };
    if (!forceSnapshot && c.sessionId) {
      payload.sinceSeq = c.confirmedSeq;
      payload.sessionId = c.sessionId;
    }
    socket.timeout(ACK_TIMEOUT_MS).emit('workflow:subscribe', payload, (err, ack) => {
      if (s.closed) return;
      s.resyncing = false;
      if (err) {
        store().setConnection('reconnecting');
        setTimeout(() => subscribe({ forceSnapshot }), RETRY_MS);
        return;
      }
      if (!ack?.ok) {
        store().setConnection('offline');
        return;
      }
      presence().setSelf(socket.id, userId);

      if (ack.snapshot) {
        const snap = ack.snapshot;
        const restarted = s.hadSession && c.sessionId && snap.sessionId && snap.sessionId !== c.sessionId;
        store().applySnapshot(snap, { clearHistory: false });
        if (restarted) toast('The server restarted — edits from the last few seconds may not have been saved.', 'info');
        if (snap.peers) presence().setPeers(snap.peers);
        if (snap.locks) presence().setLocks(snap.locks);
        s.mode = 'collab';
        s.hadSession = true;
        store().setConnection('collab');
        announceSelection(true);
        return;
      }
      if (ack.catchUp) {
        const ok = store().applyCatchUp(ack.catchUp);
        if (!ok) return subscribe({ forceSnapshot: true });
        if (ack.peers) presence().setPeers(ack.peers);
        if (ack.locks) presence().setLocks(ack.locks);
        s.mode = 'collab';
        s.hadSession = true;
        store().setConnection('collab');
        return;
      }

      // A server without the hub: fall back to whole-document saves.
      s.mode = 'rest';
      store().setConnection('rest');
      scheduleRestSave();
    });
  }

  function resync() {
    if (s.closed || s.resyncing || s.mode === 'rest') return;
    s.resyncing = true;
    client().disconnected();
    if (socket.connected) {
      store().setConnection('reconnecting');
      subscribe();
    }
  }

  // --- REST fallback ---------------------------------------------------------
  function scheduleRestSave() {
    if (s.mode !== 'rest' || s.closed) return;
    clearTimeout(s.restTimer);
    s.restTimer = setTimeout(restSave, REST_DEBOUNCE_MS);
  }

  async function restSave() {
    if (s.closed || s.mode !== 'rest' || s.restInFlight) return;
    const c = client();
    const count = c.pendingCount;
    if (!count) return;
    const doc = c.view;
    s.restInFlight = true;
    try {
      await updateWorkflow(workflowId, store().currentDocument());
      if (client() === c) store().commitPrefix(count, doc);
      store().setRestError(null);
    } catch (err) {
      store().setRestError(err?.response?.data?.error || 'Autosave failed — retrying');
      s.restTimer = setTimeout(restSave, RETRY_MS * 2);
    } finally {
      s.restInFlight = false;
      if (client() === c && c.pendingCount) scheduleRestSave();
    }
  }

  const unsubscribeStore = useWorkflowStore.subscribe((state, prev) => {
    if (s.mode === 'rest' && state.pendingCount > 0 && state.pendingCount !== prev.pendingCount) scheduleRestSave();
    if (state.nodes !== prev.nodes || state.edges !== prev.edges) announceSelection();
  });

  // --- presence out ----------------------------------------------------------
  const volatile = (event, payload) => {
    if (s.closed || s.mode !== 'collab' || !socket.connected) return;
    socket.volatile.emit(event, { workflowId, ...payload });
  };
  s.emitCursor = throttle((x, y) => volatile('presence:cursor', { x, y }), PRESENCE_MS);
  const emitDrag = throttle((moves) => volatile('presence:drag', { moves }), PRESENCE_MS);
  s.emitAway = (away) => volatile('presence:state', { away });

  function announceSelection(force = false) {
    const { nodes, edges } = store();
    const nodeIds = nodes.filter((n) => n.selected).map((n) => n.id);
    const edgeIds = edges.filter((e) => e.selected).map((e) => e.id);
    const key = `${nodeIds.join(',')}|${edgeIds.join(',')}`;
    if (!force && key === s.lastSelection) return;
    s.lastSelection = key;
    volatile('presence:select', { nodeIds, edgeIds });
  }

  collabHooks.onDrag = (moves) => emitDrag(moves);
  collabHooks.onDragEnd = () => setTimeout(() => volatile('presence:drag', { moves: [] }), PRESENCE_MS + 10);
  collabHooks.nameOf = (id) => presence().nameOf(id);

  const onVisibility = () => s.emitAway(document.visibilityState === 'hidden');
  document.addEventListener('visibilitychange', onVisibility);

  // --- events in -------------------------------------------------------------
  const mine = (payload) => !payload?.workflowId || String(payload.workflowId) === String(workflowId);
  const handlers = {
    connect: () => subscribe(),
    disconnect: () => {
      client().disconnected();
      presence().setPeers([]);
      if (s.mode !== 'rest') store().setConnection('offline');
    },
    'collab:op': (payload) => {
      if (mine(payload)) store().applyRemote(payload);
    },
    'collab:snapshot': (snap) => {
      if (!mine(snap)) return;
      const clearHistory = snap.reason === 'replaced' || snap.reason === 'restored';
      store().applySnapshot(snap, { clearHistory });
      const who = snap.by?.name || presence().nameOf(snap.by?.userId) || 'someone';
      if (snap.reason === 'replaced') toast(`Updated by ${who} — your undo history was reset.`, 'info');
      // spec/30 §6: restore carries the version it restored.
      else if (snap.reason === 'restored') toast(`${who} restored the draft to ${snap.version ? `v${snap.version}` : 'an earlier version'} — your undo history was reset.`, 'info');
      else if (snap.reason === 'server_restarted') toast('The server restarted — edits from the last few seconds may not have been saved.', 'info');
    },
    'collab:locked': (p) => mine(p) && presence().lock(p.nodeId, p.by || {}),
    'collab:unlocked': (p) => mine(p) && presence().unlock(p.nodeId),
    'collab:closed': (p) => {
      if (!mine(p)) return;
      onClosed?.({ ...p, by: { ...p.by, name: p.by?.name || presence().nameOf(p.by?.userId) } });
    },
    'presence:join': (p) => mine(p) && p.socketId !== socket.id && presence().join(p),
    'presence:leave': (p) => {
      if (!mine(p)) return;
      presence().leave(p);
      store().clearRemoteDrag(p.socketId);
    },
    'presence:cursor': (p) => mine(p) && presence().patchPeer(p.socketId, { cursor: { x: p.x, y: p.y, at: Date.now() } }),
    'presence:select': (p) => mine(p) && presence().patchPeer(p.socketId, { selection: { nodeIds: p.nodeIds || [], edgeIds: p.edgeIds || [] } }),
    'presence:drag': (p) => mine(p) && store().setRemoteDrag(p.socketId, p.moves),
    'presence:state': (p) => mine(p) && presence().patchPeer(p.socketId, { away: Boolean(p.away) }),
    // The broadcast deliberately omits the webhook token (viewers are in the
    // room), so refetch - the REST payload includes it only for roles allowed.
    'workflow:triggers_changed': (p) => {
      if (!mine(p)) return;
      getWorkflow(workflowId)
        .then((wf) => !s.closed && store().setTriggers({ schedule: wf.schedule || null, webhook: wf.webhook || null, eventTrigger: wf.eventTrigger || null }))
        .catch(() => p.triggers && store().setTriggers(p.triggers));
    },
  };
  for (const [event, handler] of Object.entries(handlers)) {
    socket.on(event, handler);
    s.offs.push(() => socket.off(event, handler));
  }

  s.close = () => {
    s.closed = true;
    clearTimeout(s.restTimer);
    s.offs.forEach((off) => off());
    unsubscribeStore();
    document.removeEventListener('visibilitychange', onVisibility);
    unbind();
    collabHooks.onDrag = null;
    collabHooks.onDragEnd = null;
    if (socket.connected && s.mode === 'collab') socket.emit('workflow:unsubscribe', { workflowId });
    presence().reset();
  };
  /** Flush a REST-mode save now (before a run, for instance). */
  s.flushNow = async () => {
    if (s.mode === 'rest') {
      clearTimeout(s.restTimer);
      await restSave();
    }
  };

  store().setConnection('reconnecting');
  if (socket.connected) subscribe();
  return () => closeWorkflowSession(s);
}

export function closeWorkflowSession(which = session) {
  if (!which) return;
  which.close?.();
  if (session === which) session = null;
}

// --- soft locks (spec/28 §5) -------------------------------------------------

function lockEmit(event, nodeId) {
  const s = session;
  if (!s || s.mode !== 'collab' || !s.socket.connected) return Promise.resolve({ ok: true, local: true });
  return new Promise((resolve) => {
    s.socket.timeout(ACK_TIMEOUT_MS).emit(event, { workflowId: s.workflowId, nodeId }, (err, ack) => {
      resolve(err ? { ok: false, error: 'timeout' } : ack || { ok: true });
    });
  });
}

export const requestLock = (nodeId) => lockEmit('collab:lock', nodeId);
export const releaseLock = (nodeId) => {
  const s = session;
  if (s?.mode === 'collab' && s.socket.connected) s.socket.emit('collab:unlock', { workflowId: s.workflowId, nodeId });
};
export const heartbeatLock = (nodeId) => {
  const s = session;
  if (s?.mode === 'collab' && s.socket.connected) s.socket.emit('collab:lock_heartbeat', { workflowId: s.workflowId, nodeId });
};

/** Cursor position in flow coordinates, throttled to 20/s. */
export function sendCursor(x, y) {
  session?.emitCursor?.(x, y);
}

/** Whether the live session is using the collaboration hub. */
export function sessionMode() {
  return session?.mode || 'offline';
}

export async function flushSession() {
  await session?.flushNow?.();
}
