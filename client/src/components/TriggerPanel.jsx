import { TRIGGER_TYPES } from '../comingSoonCatalog';
import ComingSoonBadge from './ComingSoonBadge';

export default function TriggerPanel() {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Triggers</h3>
      {TRIGGER_TYPES.map((t) => (
        <div
          key={t.key}
          title={t.live ? undefined : 'Coming soon'}
          className={`rounded-lg border px-3 py-2 text-left text-sm ${
            t.live
              ? 'border-brand-400 bg-brand-50 text-slate-800 dark:border-brand-600 dark:bg-brand-950/40 dark:text-slate-100'
              : 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-600'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">{t.label}</span>
            {t.live ? (
              <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                Active
              </span>
            ) : (
              <ComingSoonBadge />
            )}
          </div>
          <p className="mt-0.5 text-xs opacity-80">{t.description}</p>
        </div>
      ))}
    </div>
  );
}
