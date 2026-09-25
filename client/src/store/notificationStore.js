import { create } from 'zustand';
import { listNotifications, markNotificationRead, markAllNotificationsRead } from '../api/notifications';
import { on } from '../realtime/socket';
import { useToastStore } from './toastStore';

/**
 * The bell (spec/29 §4): newest notifications across every workspace, plus the
 * unread count, kept live over the user's socket room. `notification:read`
 * keeps a second tab in step when you mark things read in the first.
 */

const TOAST_KINDS = new Set(['mention', 'approval_requested']);
const RECENT = 20;

let offs = [];

function upsert(items, n) {
  const rest = items.filter((x) => x.id !== n.id);
  return [n, ...rest].sort((a, b) => new Date(b.lastAt || b.createdAt) - new Date(a.lastAt || a.createdAt)).slice(0, RECENT);
}

export const useNotificationStore = create((set, get) => ({
  items: [],
  unreadCount: 0,
  loaded: false,

  async load() {
    try {
      const data = await listNotifications({ limit: RECENT });
      set({ items: data.items, unreadCount: data.unreadCount, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  async markRead(id) {
    const n = get().items.find((x) => x.id === id);
    if (n && !n.readAt) {
      set((s) => ({
        items: s.items.map((x) => (x.id === id ? { ...x, readAt: new Date().toISOString() } : x)),
        unreadCount: Math.max(0, s.unreadCount - 1),
      }));
    }
    await markNotificationRead(id).catch(() => {});
  },

  async markAll() {
    const now = new Date().toISOString();
    set((s) => ({ items: s.items.map((x) => ({ ...x, readAt: x.readAt || now })), unreadCount: 0 }));
    await markAllNotificationsRead().catch(() => {});
  },

  /** Starts listening on the session socket; returns the stop function. */
  connect() {
    offs.forEach((off) => off());
    offs = [
      on('notification:new', (payload) => {
        const { unreadCount, ...n } = payload;
        set((s) => ({ items: upsert(s.items, n), unreadCount: unreadCount ?? s.unreadCount + 1 }));
        if (TOAST_KINDS.has(n.kind)) useToastStore.getState().push(n.title, 'info');
      }),
      on('notification:read', ({ ids, unreadCount }) => {
        const now = new Date().toISOString();
        set((s) => ({
          items: s.items.map((x) => (ids === 'all' || ids?.includes(x.id) ? { ...x, readAt: x.readAt || now } : x)),
          unreadCount: unreadCount ?? s.unreadCount,
        }));
      }),
    ];
    get().load();
    return () => {
      offs.forEach((off) => off());
      offs = [];
    };
  },

  reset() {
    offs.forEach((off) => off());
    offs = [];
    set({ items: [], unreadCount: 0, loaded: false });
  },
}));
