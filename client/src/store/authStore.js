import { create } from 'zustand';
import { useWorkspaceStore } from './workspaceStore';

const STORAGE_KEY = 'agent-orch-auth';

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { token: null, user: null };
  } catch {
    return { token: null, user: null };
  }
}

export const useAuthStore = create((set) => ({
  ...loadInitial(),
  login: (token, user) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
    set({ token, user });
  },
  logout: () => {
    localStorage.removeItem(STORAGE_KEY);
    // The next person to sign in on this browser must not inherit the previous
    // user's workspace context.
    useWorkspaceStore.getState().reset();
    set({ token: null, user: null });
  },
}));
