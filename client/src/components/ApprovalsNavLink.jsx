import { NavLink } from 'react-router-dom';
import { usePendingApprovals } from '../hooks/usePendingApprovals';
import { useCan } from '../hooks/useCan';

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
          <span className="rounded-full bg-orange-500 px-1.5 text-[10px] font-semibold leading-4 text-white" title={`${count} waiting on you`}>
            {count}
          </span>
        )}
      </span>
    </NavLink>
  );
}
