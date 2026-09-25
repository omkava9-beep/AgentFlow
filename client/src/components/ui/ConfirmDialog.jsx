import { useEffect, useRef, useState } from 'react';
import { useConfirmStore } from './confirm';

/** Renders whichever `confirm()` request is pending; mounted once at the root. */
export default function ConfirmHost() {
  const request = useConfirmStore((s) => s.request);
  const close = useConfirmStore((s) => s.close);
  const [typed, setTyped] = useState('');
  const confirmRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!request) return undefined;
    setTyped('');
    const t = setTimeout(() => (request.typeToConfirm ? inputRef.current : confirmRef.current)?.focus(), 0);
    return () => clearTimeout(t);
  }, [request]);

  if (!request) return null;
  const {
    title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive = false, typeToConfirm = null, resolve,
  } = request;
  const blocked = Boolean(typeToConfirm) && typed !== typeToConfirm;
  const answer = (value) => {
    close();
    resolve(value);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex animate-fade-in items-center justify-center bg-zinc-950/50 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) answer(false); }}
      onKeyDown={(e) => { if (e.key === 'Escape') answer(false); }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        data-testid="confirm-dialog"
        className="w-full max-w-md animate-pop-in rounded-dialog border border-default bg-surface-raised p-5 shadow-popover"
      >
        <h2 id="confirm-title" className="text-base font-semibold text-fg">{title}</h2>
        {body && <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>}
        {typeToConfirm && (
          <label className="mt-4 block text-sm text-muted">
            Type <span className="font-mono font-semibold">{typeToConfirm}</span> to confirm
            <input
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !blocked) answer(true); }}
              className="mt-1.5 h-8 w-full rounded-control border border-default bg-surface px-2.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </label>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => answer(false)}
            className="inline-flex h-8 items-center rounded-control border border-default bg-surface px-3 text-sm font-medium text-fg shadow-sm hover:bg-bg-subtle"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            data-testid="confirm-accept"
            onClick={() => answer(true)}
            disabled={blocked}
            className={`inline-flex h-8 items-center rounded-control px-3 text-sm font-medium shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${
              destructive ? 'bg-danger text-white hover:brightness-95 dark:text-zinc-950' : 'bg-accent text-accent-fg hover:bg-accent-hover'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
