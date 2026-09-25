import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * The top bar's last breadcrumb for pages whose section alone says too little:
 * a workflow's name instead of "Builder", an integration's name instead of
 * "Detail", a run id instead of "Run". Pages set it; the shell reads it.
 */
export const useBreadcrumbStore = create((set) => ({
  label: null,
  setLabel: (label) => set({ label }),
}));

/** Sets the page's breadcrumb label while it's mounted; null/undefined means "none yet". */
export function useBreadcrumb(label) {
  const setLabel = useBreadcrumbStore((s) => s.setLabel);
  useEffect(() => {
    setLabel(label || null);
    return () => setLabel(null);
  }, [label, setLabel]);
}
