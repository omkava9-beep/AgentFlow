import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, MailOpen, ExternalLink, Inbox, UserPlus, Send, Bell } from 'lucide-react';
import { listOutbox } from '../api/outbox';
import { apiErrorMessage } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { PageHeader, Card, Button, Badge, EmptyState, SkeletonTable, cx } from '../components/ui';
import { ErrorText } from '../components/ui.jsx';
import { RelativeTime } from '../components/runs/RunBits';

const URL_RE = /https?:\/\/[^\s)>"']+/;
const KIND = {
  invite: { label: 'Invite', icon: UserPlus, tone: 'accent' },
  smtp: { label: 'Email', icon: Send, tone: 'info' },
  notification: { label: 'Notification', icon: Bell, tone: 'neutral' },
};
const kindOf = (k) => KIND[k] || { label: k || 'Mail', icon: Mail, tone: 'neutral' };

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
      <PageHeader
        icon={Mail}
        title="Outbox"
        meta={<Badge size="xs">Development mail</Badge>}
        description={`Mail for ${email || 'you'}. AgentFlow doesn't send real email — invites and messages your workflows would send land here instead.`}
      />

      <ErrorText>{error}</ErrorText>

      {loading ? (
        <SkeletonTable rows={4} columns={3} />
      ) : messages.length === 0 ? (
        <EmptyState icon={Inbox} title="No messages yet" body="Invites and emails your workflows would send to you land here in development instead of being delivered." />
      ) : (
        <Card className="grid min-h-[28rem] overflow-hidden md:grid-cols-[20rem_1fr]">
          <ul className="max-h-[70vh] divide-y divide-default overflow-y-auto border-b border-default md:border-b-0 md:border-r">
            {messages.map((m) => {
              const k = kindOf(m.kind);
              const active = m._id === selectedId;
              return (
                <li key={m._id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(m._id)}
                    aria-current={active}
                    className={cx('block w-full px-4 py-3 text-left transition-colors', active ? 'bg-accent-subtle/50' : 'hover:bg-bg-subtle')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge size="xs" tone={k.tone} icon={k.icon}>{k.label}</Badge>
                      <span className="shrink-0 text-2xs text-subtle"><RelativeTime value={m.createdAt} /></span>
                    </div>
                    <p className={cx('mt-1.5 truncate text-sm', active ? 'font-semibold text-fg' : 'font-medium text-fg')}>{m.subject}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-subtle">{m.text}</p>
                  </button>
                </li>
              );
            })}
          </ul>

          {selected ? (
            <article className="flex min-w-0 flex-col p-6">
              <div className="flex items-start justify-between gap-4 border-b border-default pb-4">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-fg">{selected.subject}</h2>
                  <p className="mt-1 text-xs text-subtle">
                    To <span className="text-muted">{selected.to}</span> · {new Date(selected.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                </div>
                <Badge tone={kindOf(selected.kind).tone} icon={kindOf(selected.kind).icon}>{kindOf(selected.kind).label}</Badge>
              </div>
              <pre className="mt-4 flex-1 whitespace-pre-wrap font-sans text-sm leading-relaxed text-fg">{selected.text}</pre>
              {messageLink(selected) && (
                <div className="mt-6">
                  <Button icon={selected.kind === 'invite' ? UserPlus : ExternalLink} onClick={() => open(messageLink(selected))}>
                    {selected.kind === 'invite' ? 'Open invite' : 'Open link'}
                  </Button>
                </div>
              )}
            </article>
          ) : (
            <div className="flex items-center justify-center p-10"><EmptyState compact icon={MailOpen} title="Select a message" /></div>
          )}
        </Card>
      )}
    </div>
  );
}
