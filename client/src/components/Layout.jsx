import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';
import {
  Workflow, LayoutTemplate, PlayCircle, UserCheck, BarChart3, Blocks, KeyRound, BookOpen, Settings, Activity,
  Search, PanelLeftClose, PanelLeftOpen, Menu as MenuIcon, X, User, Inbox, Keyboard, LogOut, Sun, Moon, ChevronRight,
} from 'lucide-react';
import Logo from './Logo';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import NotificationBell from './notifications/NotificationBell';
import CommandPalette from './CommandPalette';
import { Menu, MenuLink, MenuButton, MenuSeparator } from './ui/Menu';
import Avatar from './ui/Avatar';
import Kbd from './ui/Kbd';
import { IconButton } from './ui/Button';
import Tooltip from './ui/Tooltip';
import { cx } from './ui/cx';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { useWorkspaceStore, workspacePath, defaultWorkspace } from '../store/workspaceStore';
import { useBreadcrumbStore } from '../store/breadcrumbStore';
import { usePaletteStore } from '../store/paletteStore';
import { usePendingApprovals } from '../hooks/usePendingApprovals';
import { useCan } from '../hooks/useCan';

const COLLAPSE_KEY = 'agentflow:sidebar-collapsed';

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
}

// Sidebar sections. `match` lists extra path prefixes that count as "in" the
// item (a workflow's builder and history both live under Workflows).
const SECTIONS = [
  {
    label: 'Build',
    items: [
      { path: '/dashboard', label: 'Workflows', icon: Workflow, match: ['/workflows'] },
      { path: '/templates', label: 'Templates', icon: LayoutTemplate },
    ],
  },
  {
    label: 'Operate',
    items: [
      { path: '/runs', label: 'Runs', icon: PlayCircle },
      { path: '/approvals', label: 'Approvals', icon: UserCheck, badge: 'approvals', can: 'runs:approve' },
      { path: '/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'Connect',
    items: [
      { path: '/integrations', label: 'Integrations', icon: Blocks },
      { path: '/connections', label: 'Connections', icon: KeyRound },
      { path: '/knowledge', label: 'Knowledge base', icon: BookOpen },
    ],
  },
];

const FOOTER_ITEMS = [
  { path: '/settings', label: 'Settings', icon: Settings },
  { path: '/status', label: 'Status', icon: Activity },
];

// Top-bar breadcrumb label for the section a path is in.
const SECTION_LABELS = [
  [/^\/workflows\/[^/]+\/runs/, 'Workflows', 'Run history'],
  [/^\/workflows\//, 'Workflows', 'Builder'],
  [/^\/dashboard/, 'Workflows'],
  [/^\/runs\/[^/]+/, 'Runs', 'Run'],
  [/^\/runs/, 'Runs'],
  [/^\/approvals/, 'Approvals'],
  [/^\/analytics/, 'Analytics'],
  [/^\/templates/, 'Templates'],
  [/^\/integrations\/[^/]+/, 'Integrations', 'Detail'],
  [/^\/integrations/, 'Integrations'],
  [/^\/connections/, 'Connections'],
  [/^\/knowledge/, 'Knowledge base'],
  [/^\/settings/, 'Settings'],
  [/^\/status/, 'Status'],
];

function crumbsFor(pathname, slug, label) {
  const rest = slug ? pathname.replace(new RegExp(`^/w/${slug}`), '') : pathname;
  if (pathname.startsWith('/outbox')) return ['Outbox'];
  if (pathname.startsWith('/notifications')) return ['Notifications'];
  const hit = SECTION_LABELS.find(([re]) => re.test(rest));
  if (!hit) return label ? [label] : [];
  const crumbs = hit.slice(1);
  if (!label) return crumbs;
  // The page named itself (useBreadcrumb): show that instead of the generic tail.
  if (/^\/workflows\/[^/]+\/runs/.test(rest)) return ['Workflows', label, 'Run history'];
  if (crumbs.length > 1) return [crumbs[0], label];
  return crumbs;
}

function NavItem({ item, to, collapsed, count, onNavigate }) {
  const location = useLocation();
  const Icon = item.icon;
  const extra = (item.match || []).some((m) => location.pathname.includes(m));
  const link = (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cx(
          'group flex h-8 items-center gap-2.5 rounded-md px-2 text-sm transition-colors',
          collapsed && 'justify-center px-0',
          isActive || extra
            ? 'bg-surface font-medium text-fg shadow-sm ring-1 ring-[rgb(var(--border))]  dark:ring-white/5'
            : 'text-muted hover:bg-bg-subtle hover:text-fg',
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
      {count > 0 && (
        collapsed
          ? <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-warning px-1 text-center text-[9px] font-semibold leading-4 text-white ring-2 ring-bg-subtle">{count}</span>
          : <span className="ml-auto rounded-full bg-warning-subtle px-1.5 text-2xs font-semibold tabular-nums text-warning-subtle-fg" title={`${count} waiting on you`}>{count}</span>
      )}
    </NavLink>
  );
  return (
    <li className="relative">
      {collapsed ? <Tooltip content={item.label} side="right">{link}</Tooltip> : link}
    </li>
  );
}

function Sidebar({ slug, collapsed, onToggle, onNavigate, mobile = false }) {
  const { user, logout } = useAuthStore();
  const { theme, toggle: toggleTheme } = useThemeStore();
  const canApprove = useCan('runs:approve');
  // Rendered only for approvers, so non-approvers never poll for a count.
  const approvals = usePendingApprovals();
  const navigate = useNavigate();
  const wp = (path) => workspacePath(slug, path);
  const permitted = (item) => !item.can || (item.can === 'runs:approve' ? canApprove : true);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <aside
      data-testid="app-sidebar"
      className={cx(
        'flex h-full shrink-0 flex-col border-r border-default bg-bg-subtle/60 ',
        collapsed ? 'w-16' : 'w-[var(--sidebar-w)]',
      )}
    >
      <div className={cx('flex h-[var(--topbar-h)] shrink-0 items-center gap-2 px-3', collapsed && 'justify-center px-0')}>
        <Logo className="h-6 w-6 shrink-0" />
        {!collapsed && <span className="text-sm font-semibold tracking-tight text-fg">AgentFlow</span>}
        {mobile && (
          <IconButton icon={X} label="Close menu" size="sm" className="ml-auto" onClick={onNavigate} tooltip={false} />
        )}
      </div>

      <div className={cx('px-3 pb-2', collapsed && 'px-2')}>
        <WorkspaceSwitcher compact={collapsed} />
      </div>

      <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {slug && SECTIONS.map((section) => {
          const items = section.items.filter(permitted);
          if (!items.length) return null;
          return (
            <div key={section.label} className="mt-4 first:mt-2">
              {!collapsed && <p className="mb-1 px-2 text-2xs font-medium uppercase tracking-wider text-subtle">{section.label}</p>}
              {collapsed && <div className="mx-auto mb-2 h-px w-6 bg-[rgb(var(--border))]" />}
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <NavItem
                    key={item.path}
                    item={item}
                    to={wp(item.path)}
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                    count={item.badge === 'approvals' ? approvals.items?.length || 0 : 0}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-default px-3 py-2">
        {slug && (
          <ul className="space-y-0.5">
            {FOOTER_ITEMS.map((item) => (
              <NavItem key={item.path} item={item} to={wp(item.path)} collapsed={collapsed} onNavigate={onNavigate} />
            ))}
          </ul>
        )}
        {user && (
          <div className={cx('mt-2 flex items-center gap-1', collapsed && 'flex-col')}>
            <Menu
              align="left"
              up
              title={user.name || user.email}
              testId="user-menu"
              buttonClassName={cx(
                'flex min-w-0 items-center gap-2 rounded-md p-1 text-left transition-colors hover:bg-bg-subtle',
                collapsed ? 'justify-center' : 'flex-1',
              )}
              label={
                <>
                  <Avatar name={user.name} email={user.email} seed={user.id} size="sm" />
                  {!collapsed && (
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-fg">{user.name || user.email}</span>
                      {user.name && <span className="block truncate text-2xs text-subtle">{user.email}</span>}
                    </span>
                  )}
                </>
              }
              panelClassName="w-60"
            >
              <div className="px-2 pb-1.5 pt-1">
                <p className="truncate text-sm font-medium text-fg">{user.name || user.email}</p>
                {user.name && <p className="truncate text-xs text-subtle">{user.email}</p>}
              </div>
              <MenuSeparator />
              {slug && <MenuLink to={wp('/settings/profile')}><User /> Profile</MenuLink>}
              {slug && <MenuLink to={wp('/settings')}><Settings /> Workspace settings</MenuLink>}
              <MenuLink to="/outbox"><Inbox /> Outbox</MenuLink>
              <MenuButton onClick={() => usePaletteStore.getState().openShortcuts()}><Keyboard /> Keyboard shortcuts</MenuButton>
              <MenuButton onClick={toggleTheme}>{theme === 'dark' ? <Sun /> : <Moon />} {theme === 'dark' ? 'Light theme' : 'Dark theme'}</MenuButton>
              <MenuSeparator />
              <MenuButton onClick={handleLogout}><LogOut /> Log out</MenuButton>
            </Menu>
            {!mobile && (
              <IconButton
                icon={collapsed ? PanelLeftOpen : PanelLeftClose}
                label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                size="sm"
                onClick={onToggle}
              />
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function TopBar({ slug, onOpenMobileNav }) {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const { theme, toggle } = useThemeStore();
  // Outside a workspace route (Outbox, Notifications) fall back to the default
  // workspace, the same one the nav links point at.
  const workspaceName = useWorkspaceStore((s) => (s.current || defaultWorkspace(s.workspaces))?.name);
  const crumbLabel = useBreadcrumbStore((s) => s.label);
  const openPalette = usePaletteStore((s) => s.openPalette);
  const crumbs = crumbsFor(location.pathname, slug, crumbLabel);

  return (
    <header className="sticky top-0 z-20 flex h-[var(--topbar-h)] shrink-0 items-center gap-3 border-b border-default bg-surface/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-surface/70">
      <IconButton icon={MenuIcon} label="Open menu" size="sm" className="lg:hidden" onClick={onOpenMobileNav} tooltip={false} />
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
        {workspaceName && <span className="truncate text-subtle">{workspaceName}</span>}
        {crumbs.map((c, i) => (
          <span key={`${c}-${i}`} className="flex min-w-0 items-center gap-1.5">
            {(workspaceName || i > 0) && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden="true" />}
            <span className={cx('truncate', i === crumbs.length - 1 ? 'font-medium text-fg' : 'text-subtle')}>{c}</span>
          </span>
        ))}
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {user && slug && (
          <Tooltip content={"Search and commands (⌘K)"}>
            <button aria-label={"Search and commands (⌘K)"}
            type="button"
            onClick={openPalette}
            data-testid="open-palette"
            className="flex h-8 items-center gap-2 rounded-control border border-default bg-surface pl-2.5 pr-1.5 text-sm text-subtle shadow-sm transition-colors hover:border-strong hover:text-fg"
          >
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden w-40 text-left md:inline">Search…</span>
            <Kbd className="hidden md:inline-flex">⌘K</Kbd>
          </button>
          </Tooltip>
        )}
        <IconButton icon={theme === 'dark' ? Sun : Moon} label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggle} data-testid="theme-toggle" />
        {user && <NotificationBell />}
      </div>
    </header>
  );
}

export default function Layout() {
  const user = useAuthStore((s) => s.user);
  // Layout sits above `/w/:slug`, so it reads the resolved workspace from the
  // store rather than route params. Pages outside /w/:slug (the Outbox) have no
  // current workspace; point the nav at the default one rather than hiding it.
  const slug = useWorkspaceStore((s) => s.current?.slug || defaultWorkspace(s.workspaces)?.slug);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  // Canvas-style pages get the full content width and no page padding.
  const builder = useMatch('/w/:slug/workflows/:id');
  const runMonitor = useMatch('/w/:slug/runs/:runId');
  const fullBleed = Boolean(builder || runMonitor);

  // Canvas pages (Builder, Run Monitor) need the width: the sidebar drops to
  // its icon rail there. That's a per-page override, not the saved preference -
  // expanding it on a canvas lasts until you navigate.
  const [canvasExpanded, setCanvasExpanded] = useState(false);
  useEffect(() => { setMobileOpen(false); setCanvasExpanded(false); }, [location.pathname]);
  const railed = fullBleed ? !canvasExpanded : collapsed;

  function toggleCollapsed() {
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* storage blocked */ }
      return !c;
    });
  }

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <div className="hidden lg:flex">
        <Sidebar slug={slug} collapsed={railed} onToggle={fullBleed ? () => setCanvasExpanded((v) => !v) : toggleCollapsed} />
      </div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-surface-sunken/40" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <div className="relative animate-slide-in-right bg-surface">
            <Sidebar slug={slug} collapsed={false} mobile onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar slug={slug} onOpenMobileNav={() => setMobileOpen(true)} />
        <main className={cx('min-h-0 flex-1', fullBleed ? 'flex flex-col overflow-hidden' : 'overflow-y-auto')}>
          {fullBleed ? <Outlet /> : (
            <div className="mx-auto w-full max-w-6xl px-6 py-8">
              <Outlet />
            </div>
          )}
        </main>
      </div>
      {user && <CommandPalette />}
    </div>
  );
}
