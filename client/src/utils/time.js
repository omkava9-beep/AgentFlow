export function formatRelativeTime(date) {
  const diffMs = Date.now() - new Date(date).getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 45) return 'just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(date).toLocaleDateString();
}

/** "in 3h", "in 6d" for a future instant (e.g. an invite's expiry); past ones fall back to formatRelativeTime. */
export function formatUntil(date) {
  const diffMs = new Date(date).getTime() - Date.now();
  if (diffMs <= 0) return formatRelativeTime(date);
  const min = Math.round(diffMs / 60000);
  if (min < 60) return `in ${Math.max(min, 1)}m`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `in ${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 30) return `in ${day}d`;
  return `on ${new Date(date).toLocaleDateString()}`;
}
