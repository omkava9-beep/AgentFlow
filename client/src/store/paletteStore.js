import { create } from 'zustand';

/** Open state for the ⌘K palette and the `?` shortcut sheet (spec/36 §1, §6). */
export const usePaletteStore = create((set) => ({
  open: false,
  shortcutsOpen: false,
  openPalette: () => set({ open: true, shortcutsOpen: false }),
  closePalette: () => set({ open: false }),
  togglePalette: () => set((s) => ({ open: !s.open, shortcutsOpen: false })),
  openShortcuts: () => set({ shortcutsOpen: true, open: false }),
  closeShortcuts: () => set({ shortcutsOpen: false }),
}));
