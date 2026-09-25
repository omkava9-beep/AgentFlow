import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useNotificationStore } from '../../store/notificationStore';
import { useAuthStore } from '../../store/authStore';
import NotificationRow from './NotificationRow';
import { Bell, BellOff } from 'lucide-react';

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
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-control text-muted transition-colors hover:bg-bg-subtle hover:text-fg"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            data-testid="notification-badge"
            className="absolute -right-0.5 -top-0.5 min-w-[1rem] rounded-full bg-danger px-1 text-center text-[9px] font-semibold leading-4 text-white ring-2 ring-surface dark:text-zinc-950"
          >
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1.5 w-96 animate-pop-in overflow-hidden rounded-card border border-default bg-surface-raised shadow-popover">
          <div className="flex items-center justify-between border-b border-default px-3 py-2.5">
            <span className="text-sm font-semibold text-fg">Notifications</span>
            <button
              type="button"
              onClick={markAll}
              disabled={!unreadCount}
              className="text-xs font-medium text-accent hover:underline disabled:cursor-default disabled:text-subtle disabled:no-underline"
            >
              Mark all read
            </button>
          </div>
          <div className="max-h-[26rem] divide-y divide-[rgb(var(--border))] overflow-y-auto">
            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-3 py-10 text-center"><BellOff className="h-5 w-5 text-subtle" aria-hidden="true" /><p className="text-sm text-muted">You're all caught up.</p></div>
            ) : (
              items.map((n) => <NotificationRow key={n.id} n={n} onOpen={openNotification} compact />)
            )}
          </div>
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-default px-3 py-2 text-center text-xs font-medium text-accent hover:bg-bg-subtle"
          >
            View all
          </Link>
        </div>
      )}
    </div>
  );
}
