import {
  Play, Square, Bot, Wrench, GitBranch, Shuffle, Code2, Timer, Repeat, Merge, Workflow, UserCheck, Circle,
} from 'lucide-react';

/**
 * One icon + tint per node type, used by the canvas nodes, the palette, run
 * views and anywhere a node type is named. Tints are Tailwind classes that
 * work in both themes.
 */
export const NODE_TYPES = {
  start: { icon: Play, label: 'Start', tint: 'text-emerald-600 bg-emerald-500/10 dark:text-emerald-400' },
  end: { icon: Square, label: 'End', tint: 'text-zinc-600 bg-zinc-500/10 dark:text-zinc-300' },
  agent: { icon: Bot, label: 'Agent', tint: 'text-indigo-600 bg-indigo-500/10 dark:text-indigo-300' },
  tool: { icon: Wrench, label: 'Tool', tint: 'text-amber-600 bg-amber-500/10 dark:text-amber-400' },
  condition: { icon: GitBranch, label: 'Condition', tint: 'text-violet-600 bg-violet-500/10 dark:text-violet-300' },
  transform: { icon: Shuffle, label: 'Transform', tint: 'text-cyan-600 bg-cyan-500/10 dark:text-cyan-300' },
  code: { icon: Code2, label: 'Code', tint: 'text-rose-600 bg-rose-500/10 dark:text-rose-300' },
  delay: { icon: Timer, label: 'Delay', tint: 'text-sky-600 bg-sky-500/10 dark:text-sky-300' },
  loop: { icon: Repeat, label: 'Loop', tint: 'text-teal-600 bg-teal-500/10 dark:text-teal-300' },
  merge: { icon: Merge, label: 'Merge', tint: 'text-fuchsia-600 bg-fuchsia-500/10 dark:text-fuchsia-300' },
  subworkflow: { icon: Workflow, label: 'Sub-workflow', tint: 'text-blue-600 bg-blue-500/10 dark:text-blue-300' },
  approval: { icon: UserCheck, label: 'Approval', tint: 'text-orange-600 bg-orange-500/10 dark:text-orange-300' },
};

export function nodeTypeMeta(type) {
  return NODE_TYPES[type] || { icon: Circle, label: type || 'Node', tint: 'text-zinc-500 bg-zinc-500/10' };
}

