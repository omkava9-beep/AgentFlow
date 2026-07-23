export const NODE_STYLES = {
  start: { icon: '▶', accent: 'border-green-400 bg-green-50 dark:bg-green-950/40 dark:border-green-700' },
  end: { icon: '■', accent: 'border-slate-400 bg-slate-50 dark:bg-slate-800 dark:border-slate-600' },
  agent: { icon: '🤖', accent: 'border-brand-400 bg-brand-50 dark:bg-brand-950/40 dark:border-brand-600' },
  tool: { icon: '🔧', accent: 'border-amber-400 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-600' },
  condition: { icon: '◆', accent: 'border-purple-400 bg-purple-50 dark:bg-purple-950/40 dark:border-purple-600' },
};

export const STATUS_RING = {
  pending: '',
  running: 'ring-2 ring-blue-400 animate-pulse',
  success: 'ring-2 ring-green-500',
  failed: 'ring-2 ring-red-500',
  skipped: 'opacity-40',
};
