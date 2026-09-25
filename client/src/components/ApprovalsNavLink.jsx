import { NavLink } from 'react-router-dom';
import { usePendingApprovals } from '../hooks/usePendingApprovals';
import { useCan } from '../hooks/useCan';
import { Tooltip } from './ui/index';

/** Nav item for the Approvals inbox, with a live pending count (spec/32 UI). */
export default function ApprovalsNavLink({ to, className }) {
  const canApprove = useCan('runs:approve');
  const { items } = usePendingApprovals();
  if (!canApprove) return null;
  const count = items?.length || 0;
  return (
    <NavLink to={to} className={className}>
      <span className="flex items-center gap-1.5">
        Approvals
        {count > 0 && (
          <Tooltip content={`${count} waiting on you`}>
            <span className="rounded-full bg-warning px-1.5 text-2xs font-semibold leading-4 text-white">{count}</span>
          </Tooltip>
        )}
      </span>
    </NavLink>
  );
}
