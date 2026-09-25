export const NODE_STYLES = {
  start: { icon: '▶', accent: 'border-green-400 bg-green-50 dark:bg-green-950/40 dark:border-green-700' },
  end: { icon: '■', accent: 'border-slate-400 bg-slate-50 dark:bg-slate-800 dark:border-slate-600' },
  agent: { icon: '🤖', accent: 'border-brand-400 bg-brand-50 dark:bg-brand-950/40 dark:border-brand-600' },
  tool: { icon: '🔧', accent: 'border-amber-400 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-600' },
  condition: { icon: '◆', accent: 'border-purple-400 bg-purple-50 dark:bg-purple-950/40 dark:border-purple-600' },
  // spec/31 advanced nodes.
  transform: { icon: '⇆', accent: 'border-cyan-400 bg-cyan-50 dark:bg-cyan-950/40 dark:border-cyan-700' },
  code: { icon: '{ }', accent: 'border-rose-400 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-700' },
  delay: { icon: '⏱', accent: 'border-sky-400 bg-sky-50 dark:bg-sky-950/40 dark:border-sky-700' },
  loop: { icon: '⟳', accent: 'border-teal-400 bg-teal-50 dark:bg-teal-950/40 dark:border-teal-700' },
  merge: { icon: '⋈', accent: 'border-violet-400 bg-violet-50 dark:bg-violet-950/40 dark:border-violet-700' },
  subworkflow: { icon: '↗', accent: 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 dark:border-indigo-700' },
  // spec/32.
  approval: { icon: '✋', accent: 'border-orange-400 bg-orange-50 dark:bg-orange-950/40 dark:border-orange-700' },
};

export const STATUS_RING = {
  pending: '',
  running: 'ring-2 ring-blue-400 animate-pulse',
  success: 'ring-2 ring-green-500',
  failed: 'ring-2 ring-red-500',
  skipped: 'opacity-40',
  // spec/32: parked on an approval or a long delay - amber, and not pulsing.
  waiting: 'ring-2 ring-amber-400 ring-offset-2 ring-offset-amber-100 dark:ring-offset-amber-950',
  // A failure routed down the node's error edge (spec/31 §7): amber, not red.
  handled: 'ring-2 ring-amber-400',
};

/** Colour of error handles and error edges. */
export const ERROR_COLOR = '#ef4444';
