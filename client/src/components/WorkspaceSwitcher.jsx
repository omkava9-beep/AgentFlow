import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useWorkspaceStore, workspacePath } from '../store/workspaceStore';
import { useEnsureWorkspaces } from '../hooks/useEnsureWorkspaces';
import RoleBadge from './RoleBadge';
import CreateWorkspaceDialog from './CreateWorkspaceDialog';
import { cx } from './ui/cx';

function WorkspaceMark({ name, size = 'md' }) {
  return (
    <span className={cx(
      'flex shrink-0 items-center justify-center rounded-md bg-accent font-semibold uppercase text-accent-fg',
      size === 'sm' ? 'h-5 w-5 text-2xs' : 'h-6 w-6 text-xs',
    )}
    >
      {(name || '?').slice(0, 1)}
    </span>
  );
}

/** The sidebar's workspace picker. `compact` renders just the mark (collapsed rail). */
export default function WorkspaceSwitcher({ compact = false }) {
  const { workspaces } = useEnsureWorkspaces();
  const current = useWorkspaceStore((s) => s.current);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function select(ws) {
    setOpen(false);
    // To the dashboard, not the same page: resource ids don't carry over. The
    // Builder's unsaved-changes guard still intercepts this navigation.
    if (ws.id !== current?.id) navigate(workspacePath(ws.slug, '/dashboard'));
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'flex w-full items-center gap-2 rounded-md border border-default bg-surface text-left text-sm font-medium text-fg shadow-sm transition-colors hover:border-strong',
          compact ? 'h-9 justify-center px-0' : 'h-9 px-2',
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        title={current?.name}
        data-testid="workspace-switcher"
      >
        <WorkspaceMark name={current?.name} />
        {!compact && (
          <>
            <span className="min-w-0 flex-1 truncate">{current?.name || 'Select workspace'}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden="true" />
          </>
        )}
      </button>

      {open && (
        <div role="menu" className="absolute left-0 z-40 mt-1.5 w-64 animate-pop-in overflow-hidden rounded-card border border-default bg-surface-raised p-1 shadow-popover">
          <p className="px-2 pb-1 pt-1.5 text-2xs font-medium uppercase tracking-wider text-subtle">Workspaces</p>
          <ul className="max-h-72 overflow-y-auto">
            {workspaces.map((w) => (
              <li key={w.id}>
                <button
                  role="menuitem"
                  onClick={() => select(w)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg transition-colors hover:bg-bg-subtle"
                >
                  <WorkspaceMark name={w.name} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  <RoleBadge role={w.role} />
                  {w.id === current?.id ? <Check className="h-3.5 w-3.5 text-accent" aria-label="Current" /> : <span className="w-3.5" />}
                </button>
              </li>
            ))}
          </ul>
          <div className="-mx-1 mt-1 border-t border-default px-1 pt-1">
            <button
              role="menuitem"
              onClick={() => { setOpen(false); setCreating(true); }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted transition-colors hover:bg-bg-subtle hover:text-fg"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Create workspace
            </button>
          </div>
        </div>
      )}

      {creating && <CreateWorkspaceDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
