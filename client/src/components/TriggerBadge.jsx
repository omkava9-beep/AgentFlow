const STYLES = {
  manual: { label: 'Manual', icon: '▶', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  schedule: { label: 'Scheduled', icon: '⏱', className: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300' },
  webhook: { label: 'Webhook', icon: '🔗', className: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  event: { label: 'Event', icon: '⚡', className: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  api: { label: 'API', icon: '⌁', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
};

/**
 * With five ways to start a run, "where did this one come from?" is a real
 * question. API runs (spec/24) name the key that started them when known.
 */
export default function TriggerBadge({ trigger, apiKeyName, test = false }) {
  const style = STYLES[trigger] || STYLES.manual;
  const title = trigger === 'api' && apiKeyName
    ? `Started by: API key "${apiKeyName}"`
    : `Started by: ${style.label.toLowerCase()} trigger`;
  const badge = (
    <span
      title={title}
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${style.className}`}
    >
      {style.icon} {style.label}
    </span>
  );
  if (!test) return badge;
  // spec/27 §5: runs started by "Send test event" carry a sample payload.
  return (
    <span className="inline-flex items-center gap-1">
      {badge}
      <span title="Started by “Send test event” with a sample payload" className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-orange-700 dark:bg-orange-950 dark:text-orange-300">
        Test
      </span>
    </span>
  );
}
