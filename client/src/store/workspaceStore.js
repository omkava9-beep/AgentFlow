import { create } from 'zustand';

const LAST_SLUG_KEY = 'agentflow-last-workspace';

// localStorage can be unavailable (private mode, blocked site data), and the
// last-used workspace is a convenience - never let it break routing.
function readLastSlug() {
  try {
    return localStorage.getItem(LAST_SLUG_KEY);
  } catch {
    return null;
  }
}

function writeLastSlug(slug) {
  try {
    if (slug) localStorage.setItem(LAST_SLUG_KEY, slug);
    else localStorage.removeItem(LAST_SLUG_KEY);
  } catch {
    // ignore - see readLastSlug
  }
}

/**
 * The workspace the UI is currently acting in (spec/22). `current` is what the
 * API client stamps onto every tenant-scoped request as `X-Workspace-Id`, so it
 * must only ever be set from a resolved `/w/:slug` route.
 */
export const useWorkspaceStore = create((set, get) => ({
  workspaces: [],
  loaded: false,
  current: null,

  setWorkspaces: (workspaces) => {
    const { current } = get();
    // Keep `current` in step with the fresh list (role or name may have changed),
    // and drop it if the membership is gone.
    const refreshed = current ? workspaces.find((w) => w.id === current.id) || null : null;
    set({ workspaces, loaded: true, current: refreshed });
  },

  upsertWorkspace: (workspace) =>
    set((s) => ({
      workspaces: s.workspaces.some((w) => w.id === workspace.id)
        ? s.workspaces.map((w) => (w.id === workspace.id ? { ...w, ...workspace } : w))
        : [...s.workspaces, workspace],
    })),

  setCurrent: (workspace) => {
    set({ current: workspace });
    if (workspace) writeLastSlug(workspace.slug);
  },

  /**
   * Re-reads the membership list and keeps `current` in step with it - used
   * after a role change (spec/23's `workspace:role_changed`) so permissions flip
   * live. Imported lazily: api/client imports this store, so a static import
   * here would be a cycle.
   */
  refreshWorkspaces: async () => {
    const { listWorkspaces } = await import('../api/workspaces');
    const workspaces = await listWorkspaces();
    get().setWorkspaces(workspaces);
    return workspaces;
  },

  /** Drops a workspace the user just lost access to (removed, left, deleted). */
  removeWorkspace: (id) =>
    set((s) => ({
      workspaces: s.workspaces.filter((w) => w.id !== id),
      current: s.current?.id === id ? null : s.current,
    })),

  reset: () => {
    writeLastSlug(null);
    set({ workspaces: [], loaded: false, current: null });
  },
}));

/** Last-used workspace if the user is still a member of it, else personal, else the first. */
export function defaultWorkspace(workspaces) {
  if (!workspaces?.length) return null;
  const last = readLastSlug();
  return (
    workspaces.find((w) => w.slug === last) ||
    workspaces.find((w) => w.personal) ||
    workspaces[0]
  );
}

export function workspacePath(slug, path = '/dashboard') {
  return `/w/${slug}${path.startsWith('/') ? path : `/${path}`}`;
}
