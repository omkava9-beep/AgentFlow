import { create } from 'zustand';

let toastId = 0;
const MAX_VISIBLE = 5;
// Errors stay up longer: they're the ones someone needs time to read.
const DURATIONS = { info: 5000, success: 4000, error: 8000, warning: 6000 };

/**
 * Transient outcomes (spec/36 §6): saved, invited, copied, or a failure that
 * isn't tied to a form field. `push(message, tone)` keeps its original shape;
 * the third argument adds `{ action: { label, onClick }, duration }`.
 */
export const useToastStore = create((set, get) => ({
  toasts: [],
  push: (message, tone = 'info', { action = null, duration } = {}) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone, action }].slice(-MAX_VISIBLE) }));
    const ms = duration ?? DURATIONS[tone] ?? DURATIONS.info;
    if (ms > 0) setTimeout(() => get().dismiss(id), ms);
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** `toast.success('Invited')`, `toast.error(msg, { action })`, … for code outside React. */
export const toast = {
  info: (message, opts) => useToastStore.getState().push(message, 'info', opts),
  success: (message, opts) => useToastStore.getState().push(message, 'success', opts),
  error: (message, opts) => useToastStore.getState().push(message, 'error', opts),
  warning: (message, opts) => useToastStore.getState().push(message, 'warning', opts),
};
