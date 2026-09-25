import { create } from 'zustand';

/**
 * Presence (spec/28 §4): who's here, where their cursor is, what they've
 * selected, and who holds which soft lock. Ephemeral by design - nothing here
 * is sequenced, logged or persisted.
 */

// Eight colors readable on both the light and dark canvas.
export const PEER_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#ef4444', '#84cc16'];

/** Deterministic per user, so everyone sees the same color for the same person. */
export function colorFor(userId) {
  const s = String(userId || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PEER_COLORS[h % PEER_COLORS.length];
}

/** Cursors idle for this long are hidden. */
export const CURSOR_IDLE_MS = 10_000;

const normPeer = (p) => ({
  socketId: p.socketId,
  userId: p.userId,
  name: p.name || 'Someone',
  role: p.role || 'editor',
  color: p.color || colorFor(p.userId),
  away: Boolean(p.away),
  cursor: p.cursor || null,
  selection: p.selection || { nodeIds: [], edgeIds: [] },
});

/** Locks arrive as an array or an object keyed by nodeId; normalise to a plain object. */
function normLocks(locks) {
  const out = {};
  if (Array.isArray(locks)) {
    for (const l of locks) if (l?.nodeId) out[l.nodeId] = { userId: l.userId ?? l.by?.userId, name: l.name ?? l.by?.name, socketId: l.socketId ?? l.by?.socketId };
  } else if (locks && typeof locks === 'object') {
    for (const [nodeId, l] of Object.entries(locks)) out[nodeId] = { userId: l?.userId ?? l?.by?.userId, name: l?.name ?? l?.by?.name, socketId: l?.socketId ?? l?.by?.socketId };
  }
  return out;
}

export const usePresenceStore = create((set, get) => ({
  selfSocketId: null,
  selfUserId: null,
  /** socketId -> peer */
  peers: {},
  /** nodeId -> { userId, name, socketId } */
  locks: {},

  reset: () => set({ peers: {}, locks: {}, selfSocketId: null }),
  setSelf: (selfSocketId, selfUserId) => set({ selfSocketId, selfUserId }),

  setPeers: (list = []) => {
    const peers = {};
    for (const p of list) if (p?.socketId) peers[p.socketId] = normPeer(p);
    set({ peers });
  },
  setLocks: (locks) => set({ locks: normLocks(locks) }),

  join: (p) => set((s) => ({ peers: { ...s.peers, [p.socketId]: normPeer({ ...s.peers[p.socketId], ...p }) } })),
  leave: ({ socketId }) =>
    set((s) => {
      const peers = { ...s.peers };
      delete peers[socketId];
      // A disconnect releases that socket's locks server-side; mirror it.
      const locks = Object.fromEntries(Object.entries(s.locks).filter(([, l]) => l.socketId !== socketId));
      return { peers, locks };
    }),

  patchPeer: (socketId, patch) =>
    set((s) => (s.peers[socketId] ? { peers: { ...s.peers, [socketId]: { ...s.peers[socketId], ...patch } } } : {})),

  lock: (nodeId, by = {}) => set((s) => ({ locks: { ...s.locks, [nodeId]: { userId: by.userId, name: by.name, socketId: by.socketId } } })),
  unlock: (nodeId) =>
    set((s) => {
      if (!s.locks[nodeId]) return {};
      const locks = { ...s.locks };
      delete locks[nodeId];
      return { locks };
    }),

  nameOf: (userId) => {
    if (!userId) return null;
    const peer = Object.values(get().peers).find((p) => String(p.userId) === String(userId));
    return peer?.name || null;
  },
}));

/** Peers other than this tab. */
export function otherPeers(state) {
  return Object.values(state.peers).filter((p) => p.socketId !== state.selfSocketId);
}

/** The avatar stack collapses a user's tabs into one entry (spec/28 §4). */
export function peopleFrom(peers) {
  const byUser = new Map();
  for (const p of peers) {
    const existing = byUser.get(p.userId);
    if (!existing) byUser.set(p.userId, { ...p, tabs: 1 });
    else byUser.set(p.userId, { ...existing, tabs: existing.tabs + 1, away: existing.away && p.away });
  }
  return [...byUser.values()];
}

/** Returns a throttled function that also fires on the trailing edge. */
export function throttle(fn, ms) {
  let last = 0;
  let timer = null;
  let pendingArgs = null;
  return (...args) => {
    const now = Date.now();
    pendingArgs = args;
    if (now - last >= ms) {
      last = now;
      fn(...args);
      pendingArgs = null;
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        if (pendingArgs) fn(...pendingArgs);
        pendingArgs = null;
      }, ms - (now - last));
    }
  };
}
