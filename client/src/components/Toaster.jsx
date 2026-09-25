import { useToastStore } from '../store/toastStore';

const TONES = {
  info: 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200',
  error: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
  success: 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300',
  warning: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
};
const ICONS = { info: 'ℹ️', error: '⚠️', success: '✓', warning: '⚠️' };

export default function Toaster() {
  const { toasts, dismiss } = useToastStore();
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${TONES[t.tone] || TONES.info}`}
        >
          <span aria-hidden="true" className="shrink-0">{ICONS[t.tone] || ICONS.info}</span>
          <span className="flex-1">{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => { t.action.onClick?.(); dismiss(t.id); }}
              className="shrink-0 text-xs font-semibold underline underline-offset-2"
            >
              {t.action.label}
            </button>
          )}
          <button onClick={() => dismiss(t.id)} className="shrink-0 text-xs opacity-60 hover:opacity-100" aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
