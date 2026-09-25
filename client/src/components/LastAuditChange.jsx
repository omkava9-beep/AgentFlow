import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listAudit } from '../api/audit';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useWorkspacePath } from '../hooks/useWorkspacePath';
import { useCan } from '../hooks/useCan';
import { formatRelativeTime } from '../utils/time';

/**
 * "Last change: … · 2h ago" under the Members and API keys tabs (spec/34 UI),
 * linking to the log filtered to the same category. Renders nothing for roles
 * without `audit:read`, or when there's nothing to show.
 *
 * `refreshKey` lets the host tab re-fetch after its own mutations.
 */
export default function LastAuditChange({ action, refreshKey }) {
  const current = useWorkspaceStore((s) => s.current);
  const allowed = useCan('audit:read');
  const wp = useWorkspacePath();
  const [latest, setLatest] = useState(null);

  useEffect(() => {
    if (!current || !allowed) return undefined;
    let live = true;
    listAudit(current.id, { action, limit: 1 })
      .then((page) => { if (live) setLatest(page.items[0] || null); })
      .catch(() => { if (live) setLatest(null); });
    return () => { live = false; };
  }, [current, allowed, action, refreshKey]);

  if (!allowed || !latest) return null;
  return (
    <p className="text-xs text-slate-500 dark:text-slate-400">
      Last change: {latest.summary} · {formatRelativeTime(latest.createdAt)}{' '}
      <Link to={`${wp('/settings/audit')}?action=${encodeURIComponent(action)}`} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
        View log
      </Link>
    </p>
  );
}
