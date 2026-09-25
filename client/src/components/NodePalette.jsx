import { NODE_STYLES } from './nodes/nodeStyles';
import { useCan } from '../hooks/useCan';
import { useIntegrationStore } from '../store/integrationStore';

// spec/31's grouped palette. Integrations are the Tool node, whose picker
// lists every integration from spec/26.
const GROUPS = [
  { title: 'Flow', types: ['start', 'end', 'condition', 'merge', 'delay', 'loop', 'subworkflow', 'approval'] },
  { title: 'Data', types: ['transform', 'code'] },
  { title: 'AI', types: ['agent'] },
  { title: 'Integrations', types: ['tool'] },
];

const LABELS = { subworkflow: 'Sub-workflow', tool: 'Tool / integration' };

export default function NodePalette({ onAdd }) {
  const canAuthorCode = useCan('code:author');
  // The operator can switch Code off for the whole deployment (CODE_NODE_ENABLED).
  const codeNodeEnabled = useIntegrationStore((s) => s.features?.codeNode !== false);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Add node</h3>
      {GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-1.5">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400/80">{group.title}</h4>
          {group.types.filter((type) => type !== 'code' || codeNodeEnabled).map((type) => {
            const locked = type === 'code' && !canAuthorCode;
            return (
              <button
                key={type}
                onClick={() => !locked && onAdd(type)}
                disabled={locked}
                title={locked ? 'Adding a Code node needs the code:author permission (owner or admin)' : undefined}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-sm capitalize text-slate-700 shadow-sm transition hover:border-brand-400 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <span className="w-5 text-center text-xs">{NODE_STYLES[type].icon}</span>
                {LABELS[type] || type}
                {locked && <span className="ml-auto text-xs">🔒</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
