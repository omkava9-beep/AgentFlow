import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useNotificationStore } from '../../store/notificationStore';
import { useAuthStore } from '../../store/authStore';
import NotificationRow from './NotificationRow';

/**
 * The header bell (spec/29 UI): unread count across all your workspaces
 * (capped at 99+), and a dropdown of the newest 20.
 */
export default function NotificationBell() {
  const token = useAuthStore((s) => s.token);
  const { items, unreadCount, connect, reset, markRead, markAll } = useNotificationStore();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) return undefined;
    const stop = connect();
    return () => {
      stop();
      reset();
    };
  }, [token, connect, reset]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  function openNotification(n) {
    markRead(n.id);
    setOpen(false);
    if (n.link) navigate(n.link);
  }

  const badge = unreadCount > 99 ? '99+' : unreadCount;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Notifications"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
        data-testid="notification-bell"
        className="relative rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        🔔
        {unreadCount > 0 && (
          <span
            data-testid="notification-badge"
            className="absolute -right-1.5 -top-1.5 min-w-[1.25rem] rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-5 text-white"
          >
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-96 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-slate-800">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Notifications</span>
            <button
              type="button"
              onClick={markAll}
              disabled={!unreadCount}
              className="text-xs font-medium text-brand-600 hover:underline disabled:cursor-default disabled:text-slate-400 disabled:no-underline dark:text-brand-400"
            >
              Mark all read
            </button>
          </div>
          <div className="max-h-[26rem] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
            {items.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-slate-500 dark:text-slate-400">You're all caught up.</p>
            ) : (
              items.map((n) => <NotificationRow key={n.id} n={n} onOpen={openNotification} compact />)
            )}
          </div>
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-slate-100 px-3 py-2 text-center text-xs font-medium text-brand-600 hover:bg-slate-50 dark:border-slate-800 dark:text-brand-400 dark:hover:bg-slate-800"
          >
            View all
          </Link>
        </div>
      )}
    </div>
  );
}
