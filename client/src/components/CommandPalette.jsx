import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePaletteStore } from '../store/paletteStore';
import { useWorkspaceStore, workspacePath } from '../store/workspaceStore';
import { useThemeStore } from '../store/themeStore';
import { toast } from '../store/toastStore';
import { useCan } from '../hooks/useCan';
import { createWorkflow } from '../api/workflows';
import { searchWorkspace } from '../api/search';
import { apiErrorMessage } from '../api/client';
import { fuzzyScore } from '../utils/fuzzy';

const RECENT_KEY = 'agentflow:palette:recent';
const readRecent = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
const writeRecent = (ids) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, 5)));
  } catch {
    // Private windows can refuse storage; recents are a convenience only.
  }
};

const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

/**
 * Every command the palette can offer, already filtered by permission
 * (spec/36 §1: commands a role can't use are omitted, not disabled).
 */
function useCommands() {
  const navigate = useNavigate();
  const current = useWorkspaceStore((s) => s.current);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const can = {
    edit: useCan('workflow:edit'),
    useTemplates: useCan('templates:use'),
    invite: useCan('members:invite'),
    approve: useCan('runs:approve'),
    apiKeys: useCan('apiKeys:manage'),
    audit: useCan('audit:read'),
  };

  return useMemo(() => {
    const slug = current?.slug;
    if (!slug) return [];
    const go = (path) => () => navigate(workspacePath(slug, path));
    const nav = (id, label, path, extra = {}) => ({ id: `nav:${id}`, group: 'Navigate', label, run: go(path), ...extra });

    const commands = [
      nav('dashboard', 'Dashboard', '/dashboard'),
      nav('runs', 'Runs', '/runs'),
      can.approve && nav('approvals', 'Approvals', '/approvals'),
      nav('analytics', 'Analytics', '/analytics'),
      nav('templates', 'Templates', '/templates'),
      nav('integrations', 'Integrations', '/integrations'),
      nav('connections', 'Connections', '/connections'),
      nav('knowledge', 'Knowledge base', '/knowledge'),
      nav('status', 'Status', '/status'),
      { id: 'nav:notifications', group: 'Navigate', label: 'Notifications', run: () => navigate('/notifications') },
      { id: 'nav:outbox', group: 'Navigate', label: 'Outbox', run: () => navigate('/outbox') },
      nav('settings-general', 'Settings · General', '/settings/general'),
      nav('settings-members', 'Settings · Members', '/settings/members'),
      can.apiKeys && nav('settings-api-keys', 'Settings · API keys', '/settings/api-keys'),
      nav('settings-usage', 'Settings · Usage & plan', '/settings/usage'),
      can.audit && nav('settings-audit', 'Settings · Audit log', '/settings/audit'),
      nav('settings-profile', 'Settings · Profile', '/settings/profile'),

      can.edit && {
        id: 'create:workflow',
        group: 'Create',
        label: 'New workflow',
        run: async () => {
          try {
            const wf = await createWorkflow('Untitled workflow');
            navigate(workspacePath(slug, `/workflows/${wf._id}`));
          } catch (err) {
            toast.error(apiErrorMessage(err, 'Could not create a workflow'));
          }
        },
      },
      can.edit && can.useTemplates && { id: 'create:from-template', group: 'Create', label: 'New from template…', run: go('/templates') },
      can.invite && { id: 'create:invite', group: 'Create', label: 'Invite people', run: go('/settings/members?invite=1') },

      ...workspaces
        .filter((w) => w.id !== current.id)
        .map((w) => ({
          id: `switch:${w.id}`,
          group: 'Switch workspace',
          label: w.name,
          hint: w.role,
          run: () => navigate(workspacePath(w.slug, '/dashboard')),
        })),

      { id: 'pref:theme', group: 'Preferences', label: 'Toggle theme', run: toggleTheme },
      { id: 'pref:shortcuts', group: 'Preferences', label: 'Keyboard shortcuts', run: () => usePaletteStore.getState().openShortcuts() },
    ];
    return commands.filter(Boolean);
  }, [current, workspaces, navigate, toggleTheme, can.edit, can.useTemplates, can.invite, can.approve, can.apiKeys, can.audit]);
}

/** "Jump to" results from `GET /api/search`, debounced and tagged by workspace. */
function useSearch(query, open) {
  const current = useWorkspaceStore((s) => s.current);
  const navigate = useNavigate();
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!open || !q || !current?.id) {
      setResults([]);
      setLoading(false);
      return undefined;
    }
    const requestedFor = current.id;
    const slug = current.slug;
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await searchWorkspace(q, { signal: controller.signal });
        // A response for a workspace we've since left is stale (spec/36 edge cases).
        if (useWorkspaceStore.getState().current?.id !== requestedFor) return;
        const go = (path) => () => navigate(workspacePath(slug, path));
        setResults([
          ...data.workflows.map((w) => ({ id: `wf:${w.id}`, group: 'Jump to', label: w.name, hint: 'workflow', run: go(`/workflows/${w.id}`) })),
          ...data.runs.map((r) => ({
            id: `run:${r.id}`,
            group: 'Jump to',
            label: `${r.workflowName} · run ${r.id.slice(-6)}`,
            hint: r.status,
            run: go(`/runs/${r.id}`),
          })),
          ...(data.connections || []).map((c) => ({ id: `conn:${c.id}`, group: 'Jump to', label: c.name, hint: `${c.integration} connection`, run: go('/connections') })),
          ...(data.templates || []).map((t) => ({ id: `tpl:${t.id}`, group: 'Jump to', label: t.name, hint: t.builtIn ? 'built-in template' : 'template', run: go('/templates') })),
          ...(data.members || []).map((m) => ({ id: `member:${m.id}`, group: 'Jump to', label: m.name || m.email, hint: m.role, run: go('/settings/members') })),
        ]);
      } catch {
        if (!controller.signal.aborted) setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 150);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, open, current, navigate]);

  return { results, loading };
}

export default function CommandPalette() {
  const { open, shortcutsOpen, closePalette, togglePalette, closeShortcuts, openShortcuts } = usePaletteStore();
  const commands = useCommands();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState(readRecent);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const { results: searchResults, loading } = useSearch(query, open);

  // ⌘K / Ctrl+K from anywhere - even inside a text field, since it isn't a
  // text-editing shortcut. `?` only outside inputs.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        togglePalette();
        return;
      }
      if (e.key === '?' && !isTyping(e.target) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        openShortcuts();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [togglePalette, openShortcuts]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    setRecent(readRecent());
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const items = useMemo(() => {
    const q = query.trim();
    if (!q) {
      const byId = new Map(commands.map((c) => [c.id, c]));
      const recents = recent.map((id) => byId.get(id)).filter(Boolean).map((c) => ({ ...c, group: 'Recent' }));
      const recentIds = new Set(recents.map((c) => c.id));
      return [...recents, ...commands.filter((c) => !recentIds.has(c.id))];
    }
    const matched = commands
      .map((c) => ({ c, score: fuzzyScore(q, `${c.group} ${c.label}`) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.c);
    return [...searchResults, ...matched];
  }, [query, commands, recent, searchResults]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(items.length - 1, 0)));
  }, [items.length]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function runItem(item) {
    if (!item) return;
    closePalette();
    // Only commands are remembered; search hits change from one query to the next.
    if (!/^(wf|run|conn|tpl|member):/.test(item.id)) {
      const next = [item.id, ...recent.filter((id) => id !== item.id)];
      setRecent(next);
      writeRecent(next);
    }
    item.run();
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runItem(items[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
    }
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-[65] flex items-start justify-center bg-slate-900/40 p-4 pt-[12vh] backdrop-blur-sm"
          onMouseDown={(e) => { if (e.target === e.currentTarget) closePalette(); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            data-testid="command-palette"
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 dark:border-slate-800">
              <span aria-hidden="true" className="text-slate-400">⌘</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                onKeyDown={onKeyDown}
                placeholder="Search workflows and runs, or type a command…"
                aria-label="Command"
                className="w-full bg-transparent py-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
              />
              {loading && <span className="text-xs text-slate-400">…</span>}
            </div>
            <ul ref={listRef} role="listbox" className="max-h-[50vh] overflow-y-auto py-1">
              {items.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                  {loading ? 'Searching…' : 'No matches.'}
                </li>
              )}
              {items.map((item, i) => {
                const showGroup = i === 0 || items[i - 1].group !== item.group;
                return (
                  <li key={`${item.group}:${item.id}`}>
                    {showGroup && (
                      <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{item.group}</p>
                    )}
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === active}
                      data-index={i}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => runItem(item)}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${
                        i === active
                          ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200'
                          : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      <span className="truncate">{item.label}</span>
                      {item.hint && <span className="shrink-0 text-xs capitalize text-slate-400">{item.hint}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex justify-between border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400 dark:border-slate-800">
              <span>↑↓ to move · ↵ to run · Esc to close</span>
              <span>? for shortcuts</span>
            </div>
          </div>
        </div>
      )}
      {shortcutsOpen && <ShortcutSheet onClose={closeShortcuts} />}
    </>
  );
}

const SHORTCUTS = [
  ['⌘K / Ctrl+K', 'Open the command palette'],
  ['?', 'Show this sheet'],
  ['⌘Z', 'Undo your last canvas change'],
  ['⇧⌘Z / ⌘Y', 'Redo'],
  ['⌘C / ⌘V', 'Copy / paste selected nodes'],
  ['⌘D', 'Duplicate selection'],
  ['Delete / Backspace', 'Delete selection'],
  ['C', 'Comment mode on the canvas'],
  ['Esc', 'Close dialogs and menus'],
];

function ShortcutSheet({ onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" data-testid="shortcut-sheet" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Keyboard shortcuts</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <dl className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className="flex items-center justify-between py-2">
              <dt className="text-slate-600 dark:text-slate-300">{what}</dt>
              <dd><kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-800">{keys}</kbd></dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
