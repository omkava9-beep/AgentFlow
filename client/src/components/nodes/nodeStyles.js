import { NODE_TYPES } from '../ui/nodeTypes';

/**
 * Per-type style for canvas nodes. `icon` is the lucide component and `tint`
 * the icon-tile classes, both from ui/NodeTypeIcon so the palette, nodes and
 * run views agree. `accent` is the coloured left rule on the node card.
 */
const ACCENTS = {
  start: 'before:bg-emerald-500',
  end: 'before:bg-zinc-400',
  agent: 'before:bg-indigo-500',
  tool: 'before:bg-amber-500',
  condition: 'before:bg-violet-500',
  transform: 'before:bg-cyan-500',
  code: 'before:bg-rose-500',
  delay: 'before:bg-sky-500',
  loop: 'before:bg-teal-500',
  merge: 'before:bg-fuchsia-500',
  subworkflow: 'before:bg-blue-500',
  approval: 'before:bg-orange-500',
};

export const NODE_STYLES = Object.fromEntries(
  Object.entries(NODE_TYPES).map(([type, meta]) => [type, { ...meta, accent: ACCENTS[type] }]),
);

/** Outline per run status on the canvas (run monitor, shared view). */
export const STATUS_RING = {
  pending: '',
  running: 'ring-2 ring-info/70 ring-offset-2 ring-offset-bg',
  success: 'ring-2 ring-success/70 ring-offset-2 ring-offset-bg',
  failed: 'ring-2 ring-danger/80 ring-offset-2 ring-offset-bg',
  skipped: 'opacity-45',
  // spec/32: parked on an approval or a long delay.
  waiting: 'ring-2 ring-warning/80 ring-offset-2 ring-offset-bg',
  // A failure routed down the node's error edge (spec/31 §7): amber, not red.
  handled: 'ring-2 ring-warning/80 ring-offset-2 ring-offset-bg',
};

/** Colour of error handles and error edges. */
export const ERROR_COLOR = '#ef4444';
