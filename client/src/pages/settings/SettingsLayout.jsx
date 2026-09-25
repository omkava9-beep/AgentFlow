import { NavLink, Outlet } from 'react-router-dom';
import { useWorkspacePath } from '../../hooks/useWorkspacePath';
import { useCan } from '../../hooks/useCan';
import { useWorkspaceStore } from '../../store/workspaceStore';
import RoleBadge from '../../components/RoleBadge';

const tabClass = ({ isActive }) =>
  `border-b-2 px-3 py-2 text-sm font-medium transition ${
    isActive
      ? 'border-brand-500 text-brand-700 dark:text-brand-300'
      : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
  }`;

/**
 * Workspace settings shell (spec/23). Later specs add tabs here (24 API keys,
 * 25 connections, 33 usage, 34 audit log); each tab is hidden when the caller's
 * permissions don't allow it rather than shown disabled.
 */
export default function SettingsLayout() {
  const wp = useWorkspacePath();
  const current = useWorkspaceStore((s) => s.current);
  const canManageKeys = useCan('apiKeys:manage');
  const canReadAudit = useCan('audit:read');

  return (
    <div>
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">
          Settings <RoleBadge role={current?.role} />
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{current?.name}</p>
      </div>
      <nav className="mb-6 flex gap-1 border-b border-slate-200 dark:border-slate-800">
        <NavLink to={wp('/settings/general')} className={tabClass}>General</NavLink>
        <NavLink to={wp('/settings/members')} className={tabClass}>Members</NavLink>
        {canManageKeys && <NavLink to={wp('/settings/api-keys')} className={tabClass}>API keys</NavLink>}
        <NavLink to={wp('/settings/usage')} className={tabClass}>Usage &amp; plan</NavLink>
        {canReadAudit && <NavLink to={wp('/settings/audit')} className={tabClass}>Audit log</NavLink>}
        {/* Yours, not the workspace's (spec/36 §4) - so it sits last, apart. */}
        <NavLink to={wp('/settings/profile')} className={({ isActive }) => `ml-auto ${tabClass({ isActive })}`}>Profile</NavLink>
        {/* The workspace's slice of the shared server (spec/36 §7) - a page of its own, not a tab. */}
        <NavLink to={wp('/status')} className={tabClass}>System status ↗</NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
