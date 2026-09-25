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
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) answer(false); }}
      onKeyDown={(e) => { if (e.key === 'Escape') answer(false); }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        data-testid="confirm-dialog"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <h2 id="confirm-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        {body && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{body}</p>}
        {typeToConfirm && (
          <label className="mt-4 block text-sm text-slate-600 dark:text-slate-300">
            Type <span className="font-mono font-semibold">{typeToConfirm}</span> to confirm
            <input
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !blocked) answer(true); }}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => answer(false)}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            data-testid="confirm-accept"
            onClick={() => answer(true)}
            disabled={blocked}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${
              destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-600 hover:bg-brand-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
