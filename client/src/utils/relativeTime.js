/** "3h 12m" for a duration in ms; "now" under a minute. */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'now';
  const minutes = Math.floor(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${mins}m`;
  if (mins) return `${mins}m`;
  return `${Math.max(1, Math.round(ms / 1000))}s`;
}
