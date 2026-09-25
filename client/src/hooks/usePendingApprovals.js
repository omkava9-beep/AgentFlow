import { useCallback, useEffect, useState } from 'react';
import { listApprovals } from '../api/approvals';
import { on } from '../realtime/socket';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useCan } from './useCan';

/**
 * The caller's pending approvals in the current workspace, kept live by the
 * run:waiting / run:resumed events the workspace room carries (spec/32).
 */
export function usePendingApprovals({ status = 'pending', all = false } = {}) {
  const workspaceId = useWorkspaceStore((s) => s.current?.id);
  const canApprove = useCan('runs:approve');
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    if (!workspaceId || !canApprove) return Promise.resolve();
    return listApprovals({ status, all })
      .then((rows) => { setItems(rows); setError(''); })
      .catch(() => setError('Could not load approvals'));
  }, [workspaceId, canApprove, status, all]);

  useEffect(() => {
    reload();
    // Several events can land together (a run parks, another resumes); one
    // refetch shortly after is plenty.
    let timer;
    const soon = () => { clearTimeout(timer); timer = setTimeout(reload, 250); };
    const offs = [on('run:waiting', soon), on('run:resumed', soon), on('notification:new', soon)];
    return () => { clearTimeout(timer); offs.forEach((off) => off()); };
  }, [reload]);

  return { items, error, reload };
}
