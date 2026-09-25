import { create } from 'zustand';

/**
 * A promise-based replacement for `window.confirm` (spec/36 §6):
 *
 *   if (!(await confirm({ title: 'Delete workflow?', destructive: true }))) return;
 *
 * `typeToConfirm` makes a destructive action require typing a name first.
 * One <ConfirmHost /> is mounted at the root; it renders whichever request is
 * pending.
 */
export const useConfirmStore = create((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}));

export function confirm(options) {
  const opts = typeof options === 'string' ? { title: options } : options;
  return new Promise((resolve) => {
    // A second request while one is open answers the first with "no" rather
    // than leaving its promise pending forever.
    useConfirmStore.getState().request?.resolve(false);
    useConfirmStore.getState().open({ ...opts, resolve });
  });
}

