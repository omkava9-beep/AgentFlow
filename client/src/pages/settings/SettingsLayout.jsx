import { NavLink, Outlet } from 'react-router-dom';
import { Activity, BarChart3, CircleUser, KeyRound, ScrollText, Settings, SlidersHorizontal, Users } from 'lucide-react';
import { useWorkspacePath } from '../../hooks/useWorkspacePath';
import { useCan } from '../../hooks/useCan';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import RoleBadge from '../../components/RoleBadge';
import { PageHeader, cx } from '../../components/ui/index';

function NavItem({ to, icon: Icon, children, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cx(
        'flex items-center gap-2.5 rounded-control px-2.5 py-1.5 text-sm transition-colors',
        isActive ? 'bg-bg-subtle font-medium text-fg' : 'text-muted hover:bg-bg-subtle/60 hover:text-fg',
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
      <span className="truncate">{children}</span>
    </NavLink>
  );
}

function NavGroup({ label, children }) {
  return (
    <div>
      <p className="mb-1 px-2.5 text-2xs font-semibold uppercase tracking-wider text-subtle">{label}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

/**
 * Workspace settings shell (spec/23). Each tab is hidden when the caller's
 * permissions don't allow it rather than shown disabled. Workspace settings and
 * your own account are separate groups in the side nav.
 */
export default function SettingsLayout() {
  useDocumentTitle('Settings');
  const wp = useWorkspacePath();
  const current = useWorkspaceStore((s) => s.current);
  const canManageKeys = useCan('apiKeys:manage');
  const canReadAudit = useCan('audit:read');

  return (
    <div>
      <PageHeader
        title="Settings"
        icon={Settings}
        meta={<RoleBadge role={current?.role} />}
        description={current ? `Manage ${current.name} and your account.` : undefined}
      />
      <div className="flex flex-col gap-6 md:flex-row md:gap-8">
        <nav aria-label="Settings" className="shrink-0 space-y-5 md:w-48">
          <NavGroup label="Workspace">
            <NavItem to={wp('/settings/general')} icon={SlidersHorizontal}>General</NavItem>
            <NavItem to={wp('/settings/members')} icon={Users}>Members</NavItem>
            {canManageKeys && <NavItem to={wp('/settings/api-keys')} icon={KeyRound}>API keys</NavItem>}
            <NavItem to={wp('/settings/usage')} icon={BarChart3}>Usage &amp; plan</NavItem>
            {canReadAudit && <NavItem to={wp('/settings/audit')} icon={ScrollText}>Audit log</NavItem>}
          </NavGroup>
          <NavGroup label="Account">
            <NavItem to={wp('/settings/profile')} icon={CircleUser}>Profile</NavItem>
          </NavGroup>
          <NavGroup label="System">
            {/* The workspace's slice of the shared server (spec/36 §7) - a page of its own, not a tab. */}
            <NavItem to={wp('/status')} icon={Activity}>System status</NavItem>
          </NavGroup>
        </nav>
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
