import { create } from 'zustand';

function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

function getInitialTheme() {
  const stored = localStorage.getItem('theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const initial = getInitialTheme();
applyTheme(initial);

export const useThemeStore = create((set, get) => ({
  theme: initial,
  toggle: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    applyTheme(next);
    set({ theme: next });
  },
}));
