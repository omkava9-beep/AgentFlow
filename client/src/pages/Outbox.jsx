import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listOutbox } from '../api/outbox';
import { apiErrorMessage } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { Card, Button, ErrorText } from '../components/ui';
import { formatRelativeTime } from '../utils/time';
import { SkeletonTable } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';

const URL_RE = /https?:\/\/[^\s)>"']+/;

/** The link an invite (or any message) points at, wherever the server put it. */
function messageLink(msg) {
  const meta = msg.meta || {};
  return meta.inviteUrl || meta.url || meta.link || msg.text?.match(URL_RE)?.[0] || null;
}

/**
 * Dev mail (spec/23). Nothing sends real email; whatever "would have been
 * emailed" lands here instead - and only messages addressed to you, since a
 * shared outbox would leak other tenants' invites.
 */
export default function Outbox() {
  const email = useAuthStore((s) => s.user?.email);
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    listOutbox()
      .then((list) => {
        setMessages(list);
        if (list.length) setSelectedId(list[0]._id);
      })
      .catch((err) => setError(apiErrorMessage(err, 'Failed to load your outbox')))
      .finally(() => setLoading(false));
  }, []);

  const selected = messages.find((m) => m._id === selectedId);

  function open(link) {
    try {
      const url = new URL(link, window.location.origin);
      // Same app: client-side navigation keeps the session and the SPA state.
      if (url.origin === window.location.origin) navigate(url.pathname + url.search);
      else window.location.assign(url.href);
    } catch {
      window.location.assign(link);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Outbox</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Development mail for {email}. AgentFlow doesn't send real email — invites and messages land here instead.
        </p>
      </div>

      <ErrorText>{error}</ErrorText>

      {loading ? (
        <SkeletonTable rows={4} columns={3} />
      ) : messages.length === 0 ? (
        <EmptyState icon="✉️" title="No messages yet" body="Invites and emails your workflows would send to you land here in development instead of being delivered." />
      ) : (
        <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
          <Card className="divide-y divide-slate-100 overflow-hidden p-0 dark:divide-slate-800">
            {messages.map((m) => (
              <button
                key={m._id}
                onClick={() => setSelectedId(m._id)}
                className={`block w-full px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800 ${
                  m._id === selectedId ? 'bg-brand-50 dark:bg-brand-950/40' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{m.subject}</span>
                  <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {m.kind}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-slate-400">{formatRelativeTime(m.createdAt)}</div>
              </button>
            ))}
          </Card>

          {selected && (
            <Card className="p-5">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{selected.subject}</h2>
              <p className="mt-1 text-xs text-slate-400">
                To {selected.to} · {new Date(selected.createdAt).toLocaleString()}
              </p>
              <pre className="mt-4 whitespace-pre-wrap font-sans text-sm text-slate-700 dark:text-slate-300">{selected.text}</pre>
              {messageLink(selected) && (
                <Button className="mt-4" onClick={() => open(messageLink(selected))}>
                  {selected.kind === 'invite' ? 'Open invite' : 'Open link'}
                </Button>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
