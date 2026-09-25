import { NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';
import ThemeToggle from './ThemeToggle';
import { Wordmark } from './Logo';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import NotificationBell from './notifications/NotificationBell';
import CommandPalette from './CommandPalette';
import { Menu, MenuLink, MenuButton, MenuSeparator, MenuHeading } from './ui/Menu';
import { useAuthStore } from '../store/authStore';
import { useWorkspaceStore, workspacePath, defaultWorkspace } from '../store/workspaceStore';
import { usePaletteStore } from '../store/paletteStore';
import ApprovalsNavLink from './ApprovalsNavLink';

const navLinkClass = ({ isActive }) =>
  `whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium transition ${
    isActive
      ? 'bg-gradient-to-br from-brand-500 to-purple-600 text-white shadow-sm shadow-brand-500/30'
      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
  }`;

const menuTriggerClass = (active) =>
  `flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium transition ${
    active
      ? 'bg-gradient-to-br from-brand-500 to-purple-600 text-white shadow-sm shadow-brand-500/30'
      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
  }`;

const iconButtonClass = 'rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800';

// Grouped under one "Integrations" menu so the header fits at 1280px (spec/36).
const INTEGRATION_PAGES = [
  { path: '/integrations', label: 'Integrations' },
  { path: '/connections', label: 'Connections' },
  { path: '/knowledge', label: 'Knowledge base' },
];
// Shown inline from xl (1280px) up; folded into "More" below that.
const SECONDARY_PAGES = [
  { path: '/analytics', label: 'Analytics' },
  { path: '/templates', label: 'Templates' },
];

function initialsOf(user) {
  const source = (user?.name || user?.email || '?').trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

export default function Layout() {
  const { user, logout } = useAuthStore();
  // Layout sits above `/w/:slug`, so it reads the resolved workspace from the
  // store rather than route params. Pages outside /w/:slug (the Outbox) have no
  // current workspace; point the nav at the default one rather than hiding it.
  const slug = useWorkspaceStore((s) => s.current?.slug || defaultWorkspace(s.workspaces)?.slug);
  const navigate = useNavigate();
  const location = useLocation();
  const openPalette = usePaletteStore((s) => s.openPalette);
  // The Builder is a canvas app: it gets the full window width and no page
  // padding, so its toolbar and side panels never fight over 1152px.
  const fullBleed = Boolean(useMatch('/w/:slug/workflows/:id'));

  const wp = (path) => workspacePath(slug, path);
  const inSection = (pages) => pages.some((p) => location.pathname.startsWith(wp(p.path)));

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 h-[57px] border-b border-slate-200/80 bg-white/70 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/70">
        <div className={`mx-auto flex h-14 items-center justify-between gap-3 px-4 ${fullBleed ? 'max-w-none' : 'max-w-6xl'}`}>
          <div className="flex min-w-0 items-center gap-3">
            <Wordmark className="shrink-0 text-lg" />
            <WorkspaceSwitcher />
            {slug && (
              <nav className="flex items-center gap-0.5" aria-label="Main">
                {/* Below lg everything folds into one menu. */}
                <div className="lg:hidden">
                  <Menu label={<>Menu <span className="text-xs">▾</span></>} buttonClassName={menuTriggerClass(false)} panelClassName="w-56">
                    <MenuLink to={wp('/dashboard')}>Dashboard</MenuLink>
                    <MenuLink to={wp('/runs')}>Runs</MenuLink>
                    {/* Rendered only while the menu is open, so its live count
                        doesn't double the inline link's polling. */}
                    <div data-menu-close>
                      <ApprovalsNavLink
                        to={wp('/approvals')}
                        className={({ isActive }) => `block px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${isActive ? 'font-semibold text-brand-600 dark:text-brand-400' : 'text-slate-700 dark:text-slate-200'}`}
                      />
                    </div>
                    {SECONDARY_PAGES.map((p) => <MenuLink key={p.path} to={wp(p.path)}>{p.label}</MenuLink>)}
                    <MenuSeparator />
                    {INTEGRATION_PAGES.map((p) => <MenuLink key={p.path} to={wp(p.path)}>{p.label}</MenuLink>)}
                  </Menu>
                </div>

                <div className="hidden items-center gap-0.5 lg:flex">
                  <NavLink to={wp('/dashboard')} className={navLinkClass}>Dashboard</NavLink>
                  <NavLink to={wp('/runs')} className={navLinkClass}>Runs</NavLink>
                  <ApprovalsNavLink to={wp('/approvals')} className={navLinkClass} />
                  {SECONDARY_PAGES.map((p) => (
                    <NavLink key={p.path} to={wp(p.path)} className={(s) => `${navLinkClass(s)} hidden xl:block`}>{p.label}</NavLink>
                  ))}
                  <Menu
                    label={<>Integrations <span className="text-xs">▾</span></>}
                    buttonClassName={menuTriggerClass(inSection(INTEGRATION_PAGES))}
                    testId="nav-integrations"
                  >
                    {INTEGRATION_PAGES.map((p) => <MenuLink key={p.path} to={wp(p.path)}>{p.label}</MenuLink>)}
                  </Menu>
                  <div className="xl:hidden">
                    <Menu label={<>More <span className="text-xs">▾</span></>} buttonClassName={menuTriggerClass(inSection(SECONDARY_PAGES))}>
                      {SECONDARY_PAGES.map((p) => <MenuLink key={p.path} to={wp(p.path)}>{p.label}</MenuLink>)}
                    </Menu>
                  </div>
                </div>
              </nav>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {user && slug && (
              <button
                type="button"
                onClick={openPalette}
                title="Search and commands (⌘K)"
                data-testid="open-palette"
                className={`${iconButtonClass} flex items-center gap-2`}
              >
                <span aria-hidden="true">⌕</span>
                <span className="hidden text-slate-400 xl:inline">Search</span>
                <kbd className="hidden rounded border border-slate-200 px-1 font-mono text-[10px] text-slate-400 dark:border-slate-700 xl:inline">⌘K</kbd>
              </button>
            )}
            <ThemeToggle />
            {user && (
              <>
                <NotificationBell />
                <Menu
                  align="right"
                  title={user.name || user.email}
                  testId="user-menu"
                  label={
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-purple-600 text-xs font-bold text-white">
                      {initialsOf(user)}
                    </span>
                  }
                  buttonClassName="rounded-full ring-offset-2 transition hover:ring-2 hover:ring-brand-300 dark:ring-offset-slate-950"
                  panelClassName="w-60"
                >
                  <div className="px-3 pb-2 pt-2">
                    <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{user.name || user.email}</p>
                    {user.name && <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user.email}</p>}
                  </div>
                  <MenuSeparator />
                  {slug && <MenuLink to={wp('/settings/profile')}>Profile</MenuLink>}
                  {slug && <MenuLink to={wp('/settings')}>Workspace settings</MenuLink>}
                  {slug && <MenuLink to={wp('/status')}>Status</MenuLink>}
                  <MenuLink to="/outbox">Outbox</MenuLink>
                  <MenuButton onClick={() => usePaletteStore.getState().openShortcuts()}>Keyboard shortcuts</MenuButton>
                  <MenuSeparator />
                  <MenuHeading>Session</MenuHeading>
                  <MenuButton onClick={handleLogout}>Log out</MenuButton>
                </Menu>
              </>
            )}
          </div>
        </div>
      </header>
      <main className={fullBleed ? 'flex w-full flex-1 flex-col' : 'mx-auto w-full max-w-6xl flex-1 px-4 py-6'}>
        <Outlet />
      </main>
      {user && <CommandPalette />}
    </div>
  );
}
