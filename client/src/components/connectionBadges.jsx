import { CircleAlert, CircleCheck, CircleDashed, FlaskConical, Radio } from 'lucide-react';
import { Badge } from './ui/index';
import { formatRelativeTime } from '../utils/time';

/** Live / Sandbox, the same pill everywhere a connection is listed. */
export function ConnectionModeBadge({ mode, size = 'sm' }) {
  return mode === 'live'
    ? <Badge tone="success" icon={Radio} size={size}>Live</Badge>
    : <Badge tone="neutral" icon={FlaskConical} size={size}>Sandbox</Badge>;
}

const HEALTH = {
  ok: { tone: 'success', icon: CircleCheck, label: 'Healthy' },
  error: { tone: 'danger', icon: CircleAlert, label: 'Error' },
  untested: { tone: 'neutral', icon: CircleDashed, label: 'Untested' },
};

/** Result of the last "Test connection", with when it ran. */
export function ConnectionHealth({ connection, showTime = true }) {
  const meta = HEALTH[connection?.status] || HEALTH.untested;
  const Icon = meta.icon;
  const toneClass = { success: 'text-success', danger: 'text-danger', neutral: 'text-subtle' }[meta.tone];
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-sm">
      <Icon className={`h-3.5 w-3.5 shrink-0 ${toneClass}`} aria-hidden="true" />
      <span className="text-fg">{meta.label}</span>
      {showTime && connection?.lastTestedAt && (
        <span className="truncate text-xs text-subtle">· {formatRelativeTime(connection.lastTestedAt)}</span>
      )}
    </span>
  );
}
