import { Info, AlertTriangle, CheckCircle2, XCircle, X } from 'lucide-react';
import { useToastStore } from '../store/toastStore';

const ICONS = {
  info: [Info, 'text-info'],
  error: [XCircle, 'text-danger'],
  success: [CheckCircle2, 'text-success'],
  warning: [AlertTriangle, 'text-warning'],
};

export default function Toaster() {
  const { toasts, dismiss } = useToastStore();
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => {
        const [Icon, color] = ICONS[t.tone] || ICONS.info;
        return (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex animate-pop-in items-start gap-3 rounded-card border border-default bg-surface-raised px-3.5 py-3 text-sm text-fg shadow-popover"
          >
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} aria-hidden="true" />
            <span className="min-w-0 flex-1 leading-snug">{t.message}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => { t.action.onClick?.(); dismiss(t.id); }}
                className="shrink-0 text-xs font-semibold text-accent hover:underline"
              >
                {t.action.label}
              </button>
            )}
            <button onClick={() => dismiss(t.id)} className="-mr-1 shrink-0 rounded p-0.5 text-subtle hover:bg-bg-subtle hover:text-fg" aria-label="Dismiss">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
