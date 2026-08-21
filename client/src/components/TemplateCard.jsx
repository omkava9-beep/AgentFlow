import { NODE_STYLES } from './nodes/nodeStyles';

/** A glanceable shape summary — enough to tell templates apart without a render. */
function NodeMix({ nodes = [] }) {
  const counts = nodes.reduce((acc, n) => ({ ...acc, [n.type]: (acc[n.type] || 0) + 1 }), {});
  const order = ['start', 'agent', 'tool', 'condition', 'end'];

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {order
        .filter((type) => counts[type])
        .map((type) => (
          <span
            key={type}
            title={`${counts[type]} ${type} node${counts[type] > 1 ? 's' : ''}`}
            className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${NODE_STYLES[type].accent}`}
          >
            {NODE_STYLES[type].icon} {counts[type]}
          </span>
        ))}
    </div>
  );
}

export default function TemplateCard({ template, onUse, busy }) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-400 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-600">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-semibold text-slate-900 dark:text-slate-100">{template.name}</h2>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            template.builtIn
              ? 'bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          {template.builtIn ? 'Built-in' : 'Yours'}
        </span>
      </div>

      <p className="mt-1 flex-1 text-sm text-slate-500 dark:text-slate-400">{template.description || 'No description.'}</p>

      <NodeMix nodes={template.nodes} />

      <p className="mt-2 text-xs text-slate-400">
        {template.nodeCount} {template.nodeCount === 1 ? 'node' : 'nodes'} · {template.edgeCount}{' '}
        {template.edgeCount === 1 ? 'connection' : 'connections'}
      </p>

      <button
        onClick={() => onUse(template)}
        disabled={busy}
        className="mt-4 rounded-lg bg-gradient-to-br from-brand-500 to-purple-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:brightness-110 disabled:opacity-50"
      >
        {busy ? 'Creating...' : 'Use template'}
      </button>
    </div>
  );
}
