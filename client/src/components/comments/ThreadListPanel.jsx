import { useState } from 'react';
import { X } from 'lucide-react';
import { formatRelativeTime } from '../../utils/time';
import { mentionParts } from '../../utils/mentions';

const TABS = [
  { id: 'open', label: 'Open', test: (t) => !t.resolvedAt && !t.anchor.detached },
  { id: 'resolved', label: 'Resolved', test: (t) => Boolean(t.resolvedAt) },
  { id: 'detached', label: 'Detached', test: (t) => t.anchor.detached && !t.resolvedAt },
];

const snippet = (c) => (c ? mentionParts(c.body, c.mentions).map((p) => (p.mention ? `@${p.mention.name}` : p.text)).join('') : '');

/** Open / resolved / detached threads, with jump-to and re-pin (spec/29 UI). */
export default function ThreadListPanel({ threads, onOpen, onRepin, onClose }) {
  const [tab, setTab] = useState('open');
  const current = TABS.find((t) => t.id === tab);
  const shown = threads.filter(current.test);

  return (
    <div
      data-testid="thread-list"
      className="pointer-events-auto absolute right-4 top-3 z-30 flex max-h-[85%] w-80 flex-col rounded-xl border border-default bg-surface shadow-xl"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1 border-b border-default px-2 py-1.5">
        {TABS.map((t) => {
          const n = threads.filter(t.test).length;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-md px-2 py-1 text-xs font-medium ${tab === t.id ? 'bg-accent-subtle text-accent-subtle-fg  ' : 'text-muted hover:bg-bg-subtle '}`}
            >
              {t.label}{n ? ` ${n}` : ''}
            </button>
          );
        })}
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto rounded-md px-1.5 text-subtle hover:bg-bg-subtle"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <div className="flex-1 divide-y divide-default overflow-y-auto">
        {shown.length === 0 && <p className="px-3 py-6 text-center text-xs text-subtle">No {current.label.toLowerCase()} threads.</p>}
        {shown.map((t) => (
          <div key={t.id} className="px-3 py-2">
            <button type="button" onClick={() => onOpen(t)} className="block w-full text-left">
              <span className="flex items-center gap-2 text-[11px] text-subtle">
                <span className="font-medium text-muted">{t.comments[0]?.author?.name}</span>
                <span>{formatRelativeTime(t.updatedAt || t.createdAt)}</span>
                {t.anchor.detached && <span className="rounded bg-warning-subtle px-1 text-warning-subtle-fg">node deleted</span>}
                {t.replyCount > 0 && <span className="ml-auto">{t.replyCount} repl{t.replyCount === 1 ? 'y' : 'ies'}</span>}
              </span>
              <span className="line-clamp-2 block text-sm text-fg">{snippet(t.comments[0]) || '(deleted)'}</span>
            </button>
            {t.anchor.detached && (
              <button type="button" onClick={() => onRepin(t)} className="mt-1 text-xs font-medium text-accent hover:underline">
                Pin to canvas…
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
