import { useNavigate } from 'react-router-dom';
import { FlowIcon, TrashIcon, ArrowRightIcon, NodeDotsIcon, LinkIcon } from './icons';
import { formatRelativeTime } from '../utils/time';

export default function WorkflowCard({ workflow, onDelete }) {
  const navigate = useNavigate();
  const nodeCount = workflow.nodeCount ?? 0;
  const edgeCount = workflow.edgeCount ?? 0;

  return (
    <div
      onClick={() => navigate(`/workflows/${workflow._id}`)}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-600"
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-500 via-purple-500 to-brand-400 opacity-0 transition group-hover:opacity-100" />

      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-purple-600 text-white shadow-sm">
          <FlowIcon />
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(workflow._id);
          }}
          title="Delete workflow"
          className="rounded-lg p-2 text-slate-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:text-slate-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
        >
          <TrashIcon />
        </button>
      </div>

      <h2 className="mt-3 truncate font-semibold text-slate-900 dark:text-slate-100">{workflow.name}</h2>

      <div className="mt-2 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1">
          <NodeDotsIcon />
          {nodeCount} {nodeCount === 1 ? 'node' : 'nodes'}
        </span>
        <span className="flex items-center gap-1">
          <LinkIcon />
          {edgeCount} {edgeCount === 1 ? 'connection' : 'connections'}
        </span>
      </div>

      <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">Updated {formatRelativeTime(workflow.updatedAt)}</p>

      <div className="mt-4 flex items-center gap-1 text-sm font-medium text-brand-600 dark:text-brand-400">
        Open workflow
        <ArrowRightIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </div>
    </div>
  );
}
