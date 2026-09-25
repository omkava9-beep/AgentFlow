import { useState } from 'react';
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
      className="pointer-events-auto absolute right-4 top-3 z-30 flex max-h-[85%] w-80 flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1 border-b border-slate-100 px-2 py-1.5 dark:border-slate-800">
        {TABS.map((t) => {
          const n = threads.filter(t.test).length;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-md px-2 py-1 text-xs font-medium ${tab === t.id ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            >
              {t.label}{n ? ` ${n}` : ''}
            </button>
          );
        })}
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto rounded-md px-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
      </div>
      <div className="flex-1 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
        {shown.length === 0 && <p className="px-3 py-6 text-center text-xs text-slate-400">No {current.label.toLowerCase()} threads.</p>}
        {shown.map((t) => (
          <div key={t.id} className="px-3 py-2">
            <button type="button" onClick={() => onOpen(t)} className="block w-full text-left">
              <span className="flex items-center gap-2 text-[11px] text-slate-400">
                <span className="font-medium text-slate-600 dark:text-slate-300">{t.comments[0]?.author?.name}</span>
                <span>{formatRelativeTime(t.updatedAt || t.createdAt)}</span>
                {t.anchor.detached && <span className="rounded bg-amber-100 px-1 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">node deleted</span>}
                {t.replyCount > 0 && <span className="ml-auto">{t.replyCount} repl{t.replyCount === 1 ? 'y' : 'ies'}</span>}
              </span>
              <span className="line-clamp-2 block text-sm text-slate-700 dark:text-slate-200">{snippet(t.comments[0]) || '(deleted)'}</span>
            </button>
            {t.anchor.detached && (
              <button type="button" onClick={() => onRepin(t)} className="mt-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                Pin to canvas…
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
