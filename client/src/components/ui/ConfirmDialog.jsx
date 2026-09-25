import { useEffect, useState } from 'react';
import * as AD from '@radix-ui/react-alert-dialog';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import { useConfirmStore } from './confirm';
import { cx } from './cx';

const buttonBase = 'inline-flex h-8 items-center gap-1.5 rounded-control px-3 text-sm font-medium shadow-sm disabled:cursor-not-allowed disabled:opacity-50';
const inputClass = 'mt-1.5 h-8 w-full rounded-control border border-default bg-surface px-2.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

/** Renders whichever `confirm()` / `prompt()` request is pending; mounted once at the root. */
export default function ConfirmHost() {
  const request = useConfirmStore((s) => s.request);
  const close = useConfirmStore((s) => s.close);
  const [typed, setTyped] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setTyped(request?.kind === 'prompt' ? String(request.defaultValue ?? '') : '');
    setCopied(false);
  }, [request]);

  if (!request) return null;
  const {
    kind, title, body, confirmLabel, cancelLabel = 'Cancel', destructive = false, typeToConfirm = null, resolve,
    placeholder, readOnly = false, copy = false, label,
  } = request;
  const isPrompt = kind === 'prompt';
  const blocked = (!isPrompt && Boolean(typeToConfirm) && typed !== typeToConfirm) || (isPrompt && !readOnly && !typed.trim() && request.required);
  const answer = (ok) => {
    close();
    if (isPrompt) resolve(ok ? typed : null);
    else resolve(ok);
  };

  async function doCopy() {
    try { await navigator.clipboard.writeText(typed); } catch { /* clipboard blocked */ }
    setCopied(true);
  }

  return (
    <AD.Root open onOpenChange={(o) => { if (!o) answer(false); }}>
      <AD.Portal>
        <AD.Overlay className="fixed inset-0 z-[60] bg-zinc-950/50 data-[state=open]:animate-fade-in" />
        <AD.Content
          data-testid="confirm-dialog"
          className="fixed left-1/2 top-[18vh] z-[60] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 rounded-dialog border border-default bg-surface-raised p-5 shadow-popover outline-none data-[state=open]:animate-pop-in"
        >
          <div className="flex items-start gap-3">
            {destructive && (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-danger-subtle text-danger">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <AD.Title className="text-base font-semibold text-fg">{title}</AD.Title>
              <AD.Description className={body ? 'mt-1.5 text-sm leading-relaxed text-muted' : 'sr-only'}>{body || title}</AD.Description>
            </div>
          </div>
          {typeToConfirm && !isPrompt && (
            <label className="mt-4 block text-sm text-muted">
              Type <span className="font-mono font-semibold text-fg">{typeToConfirm}</span> to confirm
              <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !blocked) answer(true); }} className={inputClass} />
            </label>
          )}
          {isPrompt && (
            <label className="mt-4 block text-sm text-muted">
              {label}
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  readOnly={readOnly}
                  value={typed}
                  placeholder={placeholder}
                  onFocus={(e) => readOnly && e.target.select()}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !blocked) answer(true); }}
                  className={cx(inputClass, readOnly && 'font-mono text-xs')}
                  data-testid="prompt-input"
                />
                {copy && (
                  <button type="button" onClick={doCopy} className={cx(buttonBase, 'mt-1.5 shrink-0 border border-default bg-surface text-fg hover:bg-bg-subtle')}>
                    {copied ? <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                )}
              </div>
            </label>
          )}
          <div className="mt-5 flex justify-end gap-2">
            {!(isPrompt && readOnly) && (
              <AD.Cancel asChild>
                <button type="button" className={cx(buttonBase, 'border border-default bg-surface text-fg hover:bg-bg-subtle')}>{cancelLabel}</button>
              </AD.Cancel>
            )}
            <AD.Action asChild>
              <button
                type="button"
                data-testid="confirm-accept"
                onClick={(e) => { e.preventDefault(); if (!blocked) answer(true); }}
                disabled={blocked}
                className={cx(buttonBase, destructive ? 'bg-danger text-white hover:brightness-95 dark:text-zinc-950' : 'bg-accent text-accent-fg hover:bg-accent-hover')}
              >
                {confirmLabel || (isPrompt ? (readOnly ? 'Done' : 'OK') : 'Confirm')}
              </button>
            </AD.Action>
          </div>
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  );
}
