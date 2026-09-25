/**
 * The zero-items state for any list (spec/36 §6): what this page is for, and the
 * one action that would put something in it.
 */
export default function EmptyState({ icon = '✨', title, body, action = null, compact = false }) {
  return (
    <div
      data-testid="empty-state"
      className={`flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white/50 text-center dark:border-slate-700 dark:bg-slate-900/40 ${
        compact ? 'px-4 py-6' : 'px-6 py-12'
      }`}
    >
      <span className={compact ? 'mb-2 text-2xl' : 'mb-3 text-3xl'} aria-hidden="true">{icon}</span>
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
      {body && <p className="mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
