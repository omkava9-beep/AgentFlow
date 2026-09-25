import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspaceStore, workspacePath } from '../store/workspaceStore';
import { useEnsureWorkspaces } from '../hooks/useEnsureWorkspaces';
import RoleBadge from './RoleBadge';
import CreateWorkspaceDialog from './CreateWorkspaceDialog';

export default function WorkspaceSwitcher() {
  const { workspaces } = useEnsureWorkspaces();
  const current = useWorkspaceStore((s) => s.current);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
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
        className="flex max-w-[11rem] items-center gap-2 rounded-lg border border-slate-200 bg-white/60 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-gradient-to-br from-brand-500 to-purple-600 text-[10px] font-bold uppercase text-white">
          {(current?.name || '?').slice(0, 1)}
        </span>
        <span className="truncate">{current?.name || 'Select workspace'}</span>
        <span className="text-xs text-slate-400">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 z-30 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
        >
          <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Workspaces</p>
          <ul className="max-h-72 overflow-y-auto py-1">
            {workspaces.map((w) => (
              <li key={w.id}>
                <button
                  role="menuitem"
                  onClick={() => select(w)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition hover:bg-slate-50 dark:hover:bg-slate-800 ${
                    w.id === current?.id ? 'font-semibold text-brand-700 dark:text-brand-300' : 'text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <span className="truncate">{w.name}</span>
                  <RoleBadge role={w.role} />
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-slate-100 p-1 dark:border-slate-800">
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setCreating(true);
              }}
              className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-brand-600 hover:bg-slate-50 dark:text-brand-400 dark:hover:bg-slate-800"
            >
              + Create workspace
            </button>
          </div>
        </div>
      )}

      {creating && <CreateWorkspaceDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
