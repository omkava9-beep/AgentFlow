const STYLES = {
  manual: { label: 'Manual', icon: '▶', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  schedule: { label: 'Scheduled', icon: '⏱', className: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300' },
  webhook: { label: 'Webhook', icon: '🔗', className: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  event: { label: 'Event', icon: '⚡', className: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
};

/** With four ways to start a run, "where did this one come from?" is a real question. */
export default function TriggerBadge({ trigger }) {
  const style = STYLES[trigger] || STYLES.manual;
  return (
    <span
      title={`Started by: ${style.label.toLowerCase()} trigger`}
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${style.className}`}
    >
      {style.icon} {style.label}
    </span>
  );
}
