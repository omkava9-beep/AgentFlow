import { io } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';
import { useWorkspaceStore, workspacePath } from '../store/workspaceStore';
import { useToastStore } from '../store/toastStore';
import { listWorkspaces } from '../api/workspaces';
import { navigateTo } from '../navigation';

/**
 * One Socket.io connection per signed-in session (spec/24). Workspace, run and
 * (in spec/28) workflow rooms all share it, so rooms are tracked here with a
 * reference count: two components watching the same run make one server join,
 * and the leave only goes out when the last of them unmounts.
 *
 * Rooms don't survive a reconnect, so every desired room is replayed on each
 * `connect`. Callers get each join's ack through `onAck`, including replays - a
 * room can become forbidden between two connections.
 */

const PAYLOAD_KEY = { workspace: 'workspaceId', run: 'runId', workflow: 'workflowId' };
const ACK_TIMEOUT_MS = 5000;

let socket = null;
let socketToken = null;
/** `${kind}:${id}` -> { kind, id, count, listeners: Set<(ack) => void> } */
const rooms = new Map();

const roomKey = (kind, id) => `${kind}:${id}`;

function emitJoin(entry) {
  if (!socket?.connected) return; // replayed on the next 'connect'
  socket
    .timeout(ACK_TIMEOUT_MS)
    .emit(`${entry.kind}:subscribe`, { [PAYLOAD_KEY[entry.kind]]: entry.id }, (err, ack) => {
      // A timeout isn't a refusal: report it distinctly so callers don't show
      // "no access" for what is only a slow or restarting server.
      const result = err ? { ok: false, error: 'timeout' } : ack || { ok: false, error: 'no_ack' };
      entry.listeners.forEach((fn) => fn(result));
    });
}

async function refreshWorkspaces() {
  const store = useWorkspaceStore.getState();
  if (typeof store.refreshWorkspaces === 'function') return store.refreshWorkspaces();
  const list = await listWorkspaces();
  useWorkspaceStore.getState().setWorkspaces(list);
  return list;
}

function handleRoleChanged({ workspaceId, role, permissions }) {
  const store = useWorkspaceStore.getState();
  // Patch immediately so the UI flips (e.g. to read-only) without waiting for
  // the refetch, then reconcile with the server's full list.
  store.upsertWorkspace({ id: workspaceId, role, permissions });
  if (store.current?.id === workspaceId) {
    store.setCurrent({ ...store.current, role, permissions });
  }
  refreshWorkspaces().catch(() => {});
}

async function handleAccessRevoked({ workspaceId }) {
  const store = useWorkspaceStore.getState();
  const wasCurrent = store.current?.id === workspaceId;
  const name = store.workspaces.find((w) => w.id === workspaceId)?.name;

  // Local room bookkeeping for that workspace is now meaningless - the server
  // has already evicted this socket from its rooms.
  rooms.delete(roomKey('workspace', workspaceId));

  let list = [];
  try {
    list = await refreshWorkspaces();
  } catch {
    list = useWorkspaceStore.getState().workspaces.filter((w) => w.id !== workspaceId);
  }
  if (!wasCurrent) return;

  useToastStore.getState().push(`You no longer have access to ${name ? `“${name}”` : 'that workspace'}.`, 'error');
  const fallback = (list || []).find((w) => w.personal) || list?.[0];
  if (fallback) navigateTo(workspacePath(fallback.slug, '/dashboard'));
}

function connect(token) {
  socketToken = token;
  socket = io(import.meta.env.VITE_SOCKET_URL, { auth: { token } });

  socket.on('connect', () => {
    rooms.forEach(emitJoin);
  });

  socket.on('connect_error', (err) => {
    // Same treatment as an HTTP 401: the session is no good any more.
    if (err?.message === 'unauthorized') {
      useAuthStore.getState().logout();
      if (window.location.pathname !== '/login') window.location.assign('/login');
    }
  });

  socket.on('workspace:role_changed', handleRoleChanged);
  socket.on('workspace:access_revoked', (payload) => {
    handleAccessRevoked(payload).catch(() => {});
  });
}

function disconnect() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
  }
  socket = null;
  socketToken = null;
  rooms.clear();
}

/** Returns the session socket, creating it on first use while signed in. */
export function getSocket() {
  const { token } = useAuthStore.getState();
  if (!token) return null;
  if (!socket || socketToken !== token) {
    disconnect();
    connect(token);
  }
  return socket;
}

// Tear the socket down on logout, and rebuild it if a different token arrives.
useAuthStore.subscribe((state, prev) => {
  if (state.token === prev.token) return;
  if (!state.token) disconnect();
  else if (socket) getSocket();
});

/**
 * Join a room. `onAck` receives `{ ok, error? }` for this join and every replay
 * after a reconnect. Returns a function that undoes exactly this subscription.
 */
export function subscribe(kind, id, onAck) {
  if (!PAYLOAD_KEY[kind]) throw new Error(`Unknown room kind: ${kind}`);
  if (!id) return () => {};
  getSocket();

  const key = roomKey(kind, id);
  let entry = rooms.get(key);
  const isNew = !entry;
  if (isNew) {
    entry = { kind, id, count: 0, listeners: new Set() };
    rooms.set(key, entry);
  }
  entry.count += 1;
  if (onAck) entry.listeners.add(onAck);
  if (isNew) emitJoin(entry);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    unsubscribe(kind, id, onAck);
  };
}

export function unsubscribe(kind, id, onAck) {
  const key = roomKey(kind, id);
  const entry = rooms.get(key);
  if (!entry) return;
  if (onAck) entry.listeners.delete(onAck);
  entry.count -= 1;
  if (entry.count > 0) return;
  rooms.delete(key);
  if (socket?.connected) socket.emit(`${kind}:unsubscribe`, { [PAYLOAD_KEY[kind]]: id });
}

/** Listen for a server event on the session socket; returns an off function. */
export function on(event, handler) {
  const s = getSocket();
  if (!s) return () => {};
  s.on(event, handler);
  return () => s.off(event, handler);
}
