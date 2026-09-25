import { toast as sonner } from 'sonner';

// Errors stay up longer: they're the ones someone needs time to read.
const DURATIONS = { info: 5000, success: 4000, error: 8000, warning: 6000 };

function show(message, tone = 'info', { action = null, duration } = {}) {
  const fn = { success: sonner.success, error: sonner.error, warning: sonner.warning, info: sonner.info }[tone] || sonner;
  return fn(message, {
    duration: duration ?? DURATIONS[tone] ?? DURATIONS.info,
    action: action ? { label: action.label, onClick: () => action.onClick?.() } : undefined,
  });
}

/**
 * Transient outcomes (spec/36 §6): saved, invited, copied, or a failure that
 * isn't tied to a form field. Rendered by sonner (<Toaster/> at the root);
 * this keeps the original store API so callers don't change:
 * `useToastStore((s) => s.push)(message, tone, { action, duration })`.
 */
const api = {
  push: show,
  dismiss: (id) => sonner.dismiss(id),
};

export function useToastStore(selector) {
  return selector ? selector(api) : api;
}
useToastStore.getState = () => api;

/** `toast.success('Invited')`, `toast.error(msg, { action })`, … for code outside React. */
export const toast = {
  info: (message, opts) => show(message, 'info', opts),
  success: (message, opts) => show(message, 'success', opts),
  error: (message, opts) => show(message, 'error', opts),
  warning: (message, opts) => show(message, 'warning', opts),
};
