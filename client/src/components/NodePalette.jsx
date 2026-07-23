import { NODE_STYLES } from './nodes/nodeStyles';

const TYPES = ['start', 'agent', 'tool', 'condition', 'end'];

export default function NodePalette({ onAdd }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Add node</h3>
      {TYPES.map((type) => (
        <button
          key={type}
          onClick={() => onAdd(type)}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm capitalize text-slate-700 shadow-sm transition hover:border-brand-400 hover:bg-brand-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <span>{NODE_STYLES[type].icon}</span>
          {type}
        </button>
      ))}
    </div>
  );
}
