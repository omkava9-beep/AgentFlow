import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, BellOff } from 'lucide-react';
import { listNotifications } from '../api/notifications';
import { useNotificationStore } from '../store/notificationStore';
import NotificationRow from '../components/notifications/NotificationRow';
import { KIND_META } from '../components/notifications/notificationKinds';
import { PageHeader, Button, Card, Segmented, Select, EmptyState, SkeletonTable } from '../components/ui';

const KIND_FILTERS = [
  { value: '', label: 'All kinds' },
  ...Object.entries(KIND_META).map(([value, meta]) => ({ value, label: meta.label, icon: meta.icon })),
];

/** "Today" / "Yesterday" / "Earlier" by local calendar day. */
function groupOf(date) {
  const d = new Date(date);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  if (d >= start) return 'Today';
  if (d >= new Date(start.getTime() - 86400000)) return 'Yesterday';
  return 'Earlier';
}

/** Every notification across your workspaces, paginated (spec/29 UI). */
export default function Notifications() {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [filter, setFilter] = useState('all');
  const [kind, setKind] = useState('');
  const [loading, setLoading] = useState(true);
  const { markRead, markAll, unreadCount } = useNotificationStore();
  const navigate = useNavigate();
  const unreadOnly = filter === 'unread';

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

  const shown = kind ? items.filter((n) => n.kind === kind) : items;
  const groups = useMemo(() => {
    const out = [];
    for (const n of shown) {
      const g = groupOf(n.lastAt || n.createdAt);
      if (!out.length || out[out.length - 1].label !== g) out.push({ label: g, items: [] });
      out[out.length - 1].items.push(n);
    }
    return out;
  }, [shown]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        icon={Bell}
        title="Notifications"
        description="Mentions, replies, failed runs and invites from all your workspaces."
        actions={(
          <Button
            size="sm"
            variant="secondary"
            icon={CheckCheck}
            disabled={!unreadCount}
            onClick={async () => {
              await markAll();
              setItems((prev) => prev.map((x) => ({ ...x, readAt: x.readAt || new Date().toISOString() })));
            }}
          >
            Mark all read
          </Button>
        )}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          aria-label="Show"
          value={filter}
          onChange={setFilter}
          items={[{ value: 'all', label: 'All' }, { value: 'unread', label: `Unread${unreadCount ? ` · ${unreadCount}` : ''}` }]}
        />
        <div className="w-48"><Select size="sm" aria-label="Kind" value={kind} onValueChange={setKind} options={KIND_FILTERS} /></div>
      </div>

      {loading && items.length === 0 && <SkeletonTable rows={5} columns={2} />}
      {!loading && shown.length === 0 && (
        <EmptyState
          icon={unreadOnly ? BellOff : Bell}
          title={unreadOnly ? 'You’re all caught up' : kind ? 'Nothing of this kind' : 'Nothing here yet'}
          body={unreadOnly || kind ? undefined : 'Mentions, replies, failed runs you watch and approvals waiting on you land here.'}
        />
      )}
      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.label}>
            <h2 className="mb-2 text-xs font-medium text-subtle">{g.label}</h2>
            <Card className="divide-y divide-default overflow-hidden">
              {g.items.map((n) => <NotificationRow key={n.id} n={n} onOpen={open} />)}
            </Card>
          </section>
        ))}
      </div>
      {cursor && (
        <div className="mt-4 text-center">
          <Button size="sm" variant="secondary" loading={loading} onClick={() => load(cursor)}>Load more</Button>
        </div>
      )}
    </div>
  );
}
