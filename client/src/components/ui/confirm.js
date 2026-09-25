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


/**
 * A promise-based replacement for `window.prompt`. Resolves to the entered
 * string, or `null` when cancelled. `readOnly` + `copy: true` turns it into a
 * "here's a link, copy it" dialog.
 *
 *   const name = await prompt({ title: 'Rename', defaultValue: 'x', confirmLabel: 'Save' });
 */
export function prompt(options) {
  const opts = typeof options === 'string' ? { title: options } : options;
  return new Promise((resolve) => {
    useConfirmStore.getState().request?.resolve(opts.kind === 'prompt' ? null : false);
    useConfirmStore.getState().open({ ...opts, kind: 'prompt', resolve });
  });
}
