import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useRunSocket } from '../hooks/useRunSocket';
import { getWorkflow } from '../api/workflows';
import RunGraphView from '../components/RunGraphView';
import { StatusBadge } from '../components/ui';

export default function RunMonitor() {
  const { runId } = useParams();
  const { run, logs } = useRunSocket(runId);
  const [workflow, setWorkflow] = useState(null);

  useEffect(() => {
    if (run?.workflowId) {
      getWorkflow(run.workflowId).then(setWorkflow).catch(() => {});
    }
  }, [run?.workflowId]);

  if (!run) return <p className="text-sm text-slate-500 dark:text-slate-400">Loading run...</p>;

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100vh-57px)] flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3">
          {workflow && (
            <Link to={`/workflows/${workflow._id}`} className="text-sm text-brand-600 hover:underline dark:text-brand-400">
              ← {workflow.name}
            </Link>
          )}
          <StatusBadge status={run.status} />
        </div>
        <span className="text-xs text-slate-400">
          {run.startedAt && `Started ${new Date(run.startedAt).toLocaleTimeString()}`}
          {run.finishedAt && ` · Finished ${new Date(run.finishedAt).toLocaleTimeString()}`}
        </span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          <RunGraphView workflow={workflow} nodeResults={run.nodeResults} />
        </div>
        <div className="w-96 overflow-y-auto border-l border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Node results</h3>
          <div className="mb-4 space-y-2">
            {run.nodeResults.map((r) => (
              <div key={r.nodeId} className="rounded-lg border border-slate-200 bg-white p-2 text-xs dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-700 dark:text-slate-200">{r.nodeId}</span>
                  <StatusBadge status={r.status} />
                </div>
                {r.output !== undefined && r.output !== null && (
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-slate-500 dark:text-slate-400">
                    {JSON.stringify(r.output, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>

          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Logs</h3>
          <div className="space-y-1 font-mono text-[11px]">
            {logs.map((l, i) => (
              <div
                key={i}
                className={
                  l.line.includes('[simulated failure]')
                    ? 'text-red-500'
                    : 'text-slate-500 dark:text-slate-400'
                }
              >
                [{l.nodeId}] {l.line}
              </div>
            ))}
            {logs.length === 0 && <p className="text-slate-400">No logs yet...</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
