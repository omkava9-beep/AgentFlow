import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listNotifications } from '../api/notifications';
import { useNotificationStore } from '../store/notificationStore';
import NotificationRow from '../components/notifications/NotificationRow';
import { Button, Card } from '../components/ui';
import { SkeletonTable } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';

/** Every notification across your workspaces, paginated (spec/29 UI). */
export default function Notifications() {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const { markRead, markAll, unreadCount } = useNotificationStore();
  const navigate = useNavigate();

  const load = useCallback(async (before) => {
    setLoading(true);
    try {
      const data = await listNotifications({ unread: unreadOnly, before, limit: 30 });
      setItems((prev) => (before ? [...prev, ...data.items] : data.items));
      setCursor(data.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [unreadOnly]);

  useEffect(() => { load(); }, [load]);

  function open(n) {
    markRead(n.id);
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: x.readAt || new Date().toISOString() } : x)));
    if (n.link) navigate(n.link);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Notifications</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Mentions, replies, failed runs and invites from all your workspaces.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
            Unread only
          </label>
          <Button
            variant="secondary"
            disabled={!unreadCount}
            onClick={async () => {
              await markAll();
              setItems((prev) => prev.map((x) => ({ ...x, readAt: x.readAt || new Date().toISOString() })));
            }}
          >
            Mark all read
          </Button>
        </div>
      </div>
      {loading && items.length === 0 && <SkeletonTable rows={5} columns={2} />}
      {!loading && items.length === 0 && (
        <EmptyState
          icon="🔔"
          title={unreadOnly ? 'No unread notifications' : 'Nothing here yet'}
          body={unreadOnly ? undefined : 'Mentions, replies, failed runs you watch and approvals waiting on you land here.'}
        />
      )}
      <Card className={`divide-y divide-slate-100 overflow-hidden p-0 dark:divide-slate-800 ${items.length ? '' : 'hidden'}`}>
        {items.map((n) => <NotificationRow key={n.id} n={n} onOpen={open} />)}
      </Card>
      {cursor && (
        <div className="mt-4 text-center">
          <Button variant="secondary" disabled={loading} onClick={() => load(cursor)}>
            {loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
