import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useRunSocket } from '../hooks/useRunSocket';
import { getWorkflow } from '../api/workflows';
import { cancelRun } from '../api/runs';
import { apiErrorMessage } from '../api/client';
import { useWorkspacePath } from '../hooks/useWorkspacePath';
import ResourceNotFound from '../components/ResourceNotFound';
import RunGraphView from '../components/RunGraphView';
import QueueIndicator from '../components/QueueIndicator';
import TriggerBadge from '../components/TriggerBadge';
import ToolCallTimeline from '../components/ToolCallTimeline';
import { StatusBadge, Button } from '../components/ui';
import ApprovalBanner from '../components/ApprovalBanner';
import VersionBadge from '../components/versions/VersionBadge';
import { useIntegrationStore } from '../store/integrationStore';
import RunOpsActions from '../components/runs/RunOpsActions';
import RunLineage from '../components/runs/RunLineage';
import AttemptsTimeline from '../components/runs/AttemptsTimeline';
import RunGantt from '../components/runs/RunGantt';

// `waiting` (spec/32) is still active: it can be cancelled, and it will continue.
const ACTIVE_STATUSES = ['pending', 'running', 'waiting'];

/** Simulated failures are expected, not bugs - phrase them as such visually. */
function logLineClass(line) {
  if (line.includes('[simulated failure]')) return 'text-amber-600 dark:text-amber-400';
  if (line.includes('retrying in')) return 'text-amber-700/80 dark:text-amber-500/80';
  if (line.startsWith('[condition]') || line.startsWith('[handoff]')) return 'text-brand-600 dark:text-brand-400';
  if (line.startsWith('[error-branch]')) return 'text-amber-600 dark:text-amber-400';
  if (line.startsWith('[loop]') || line.startsWith('[subworkflow]')) return 'text-indigo-600 dark:text-indigo-400';
  return 'text-slate-500 dark:text-slate-400';
}

export default function RunMonitor() {
  const { runId } = useParams();
  const wp = useWorkspacePath();
  const { run, logs, queueStats, loadError } = useRunSocket(runId);
  const [workflow, setWorkflow] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');
  // spec/35 §6: the run-level Timeline tab sits beside Graph.
  const [view, setView] = useState('graph');
  const loadCatalog = useIntegrationStore((s) => s.loadCatalog);

  // Only for integration names and icons on the graph; ids render without it.
  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (run?.workflowId) {
      getWorkflow(run.workflowId).then(setWorkflow).catch(() => {});
    }
  }, [run?.workflowId]);

  async function handleCancel() {
    setCancelling(true);
    setCancelError('');
    try {
      await cancelRun(runId);
    } catch (err) {
      setCancelError(apiErrorMessage(err, 'Failed to cancel run'));
    } finally {
      setCancelling(false);
    }
  }

  if (loadError === 'not-found') return <ResourceNotFound kind="run" />;
  if (loadError === 'no-access') {
    return <p className="text-sm text-slate-500 dark:text-slate-400">You no longer have access to this run.</p>;
  }
  if (loadError && !run) return <p className="text-sm text-red-500">Failed to load run.</p>;
  if (!run) return <p className="text-sm text-slate-500 dark:text-slate-400">Loading run...</p>;

  const isActive = ACTIVE_STATUSES.includes(run.status);
  // spec/30 §2: draw the graph this run executed (its version, or its draft
  // snapshot), never today's draft. Runs from before versioning recorded
  // neither, so they fall back to the current workflow with a note.
  const graphWorkflow = run.graph
    ? { ...(workflow || {}), name: run.graph.name ?? workflow?.name, nodes: run.graph.nodes, edges: run.graph.edges }
    : workflow;
  const labels = new Map((graphWorkflow?.nodes || []).map((n) => [n.id, n.data?.config?.label || n.id]));
  const labelOf = (id) => labels.get(id) || id;

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100vh-57px)] flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3">
          {run.parentRunId && (
            // spec/31: a child run links back up its lineage.
            <span className="flex items-center gap-1 text-xs text-slate-500">
              {run.rootRunId && String(run.rootRunId) !== String(run.parentRunId) && (
                <><Link to={wp(`/runs/${run.rootRunId}`)} className="hover:underline">root run</Link>›</>
              )}
              <Link to={wp(`/runs/${run.parentRunId}`)} className="text-brand-600 hover:underline dark:text-brand-400">
                ↑ parent run{run.iteration !== null && run.iteration !== undefined ? ` (item ${run.iteration})` : ''}
              </Link>
            </span>
          )}
          {workflow && (
            <Link to={wp(`/workflows/${workflow._id}`)} className="text-sm text-brand-600 hover:underline dark:text-brand-400">
              ← {workflow.name}
            </Link>
          )}
          <StatusBadge status={run.status} />
          <TriggerBadge trigger={run.trigger} apiKeyName={run.apiKeyName} test={run.input?.test === true} />
          <VersionBadge isDraft={run.isDraft} versionNumber={run.versionNumber} long />
          {!run.graph && workflow && (
            <span className="text-xs text-amber-600 dark:text-amber-400" title="This run predates versioning, so it's drawn against the current workflow.">
              pre-versioning run — graph may have changed
            </span>
          )}
          {run.cancelReason === 'timeout' && (
            <span className="text-xs text-amber-600 dark:text-amber-400">timed out</span>
          )}
          {run.failReason === 'interrupted' && (
            <span className="text-xs text-red-600 dark:text-red-400" title="The server restarted while this run was executing (spec/32).">interrupted</span>
          )}
          {isActive && (
            <Button variant="secondary" className="!px-3 !py-1 text-xs" onClick={handleCancel} disabled={cancelling}>
              {cancelling ? 'Cancelling...' : 'Cancel run'}
            </Button>
          )}
          {cancelError && <span className="text-xs text-red-500">{cancelError}</span>}
          <RunLineage run={run} labelOf={labelOf} linkTo={(id) => wp(`/runs/${id}`)} currentVersion={workflow?.publishedVersion} />
          <RunOpsActions run={run} labelOf={labelOf} />
        </div>
        <div className="flex items-center gap-4">
          {isActive && <QueueIndicator stats={queueStats} />}
          <span className="text-xs text-slate-400">
            {run.startedAt && `Started ${new Date(run.startedAt).toLocaleTimeString()}`}
            {run.finishedAt && ` · Finished ${new Date(run.finishedAt).toLocaleTimeString()}`}
          </span>
        </div>
      </div>

      <ApprovalBanner run={run} />

      <div className="flex flex-1 overflow-hidden">
        <div className="relative flex-1">
          <div className="absolute right-3 top-3 z-10 flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs shadow-sm dark:border-slate-700 dark:bg-slate-900">
            {['graph', 'timeline'].map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`rounded px-2.5 py-1 font-medium capitalize ${view === v ? 'bg-brand-500 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}
              >
                {v}
              </button>
            ))}
          </div>
          {view === 'graph'
            ? <RunGraphView workflow={graphWorkflow} nodeResults={run.nodeResults} />
            : <div className="h-full pt-12"><RunGantt run={run} labelOf={labelOf} /></div>}
        </div>
        <div className="w-96 overflow-y-auto border-l border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Node results</h3>
          <div className="mb-4 space-y-2">
            {run.nodeResults.map((r) => (
              <div key={r.nodeId} className="rounded-lg border border-slate-200 bg-white p-2 text-xs dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-700 dark:text-slate-200">{r.nodeId}</span>
                  <div className="flex items-center gap-1.5">
                    {r.reused && (
                      <span
                        title="Reused from the original run - not executed again (spec/35)"
                        className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 opacity-80 dark:bg-slate-800 dark:text-slate-400"
                      >
                        ⟲ reused
                      </span>
                    )}
                    {r.toolCalls?.length > 0 && (
                      <span
                        title="Tool calls this agent made (spec/37)"
                        className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300"
                      >
                        🔧 {r.toolCalls.length}
                      </span>
                    )}
                    {r.handled && (
                      <span
                        title="Failed, but routed down its error branch - the run continues"
                        className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                      >
                        handled
                      </span>
                    )}
                    {r.waiting && r.status === 'running' && (
                      <span className="rounded border border-dashed border-slate-400 px-1.5 py-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                        Waiting for a slot ({r.waitReason === 'cap' ? 'workspace cap' : 'shared pool'})
                      </span>
                    )}
                    {r.progress && (
                      <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                        {r.progress.done} / {r.progress.total}
                      </span>
                    )}
                    {r.attempts > 1 && (
                      <span
                        title="Retried before settling"
                        className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                      >
                        attempt {r.attempts}
                      </span>
                    )}
                    {r.handoffTarget && (
                      <span
                        title="Branch chosen by this handoff agent"
                        className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300"
                      >
                        ⇄ {r.handoffTarget}
                      </span>
                    )}
                    {r.mode && (
                      <span
                        title={r.integration ? `${r.integration}.${r.action} ran ${r.mode}` : `Ran ${r.mode}`}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          r.mode === 'live'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {r.mode}
                      </span>
                    )}
                    {r.cached && (
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                        cached
                      </span>
                    )}
                    <StatusBadge status={r.status} />
                  </div>
                </div>
                {r.toolCalls?.length > 0 && (
                  <ToolCallTimeline
                    calls={r.toolCalls}
                    agentSteps={r.agentSteps}
                    finished={r.status === 'success'}
                  />
                )}
                {(r.attemptsLog?.length > 1 || r.attemptsLog?.some((a) => a.outcome === 'failed')) && (
                  <AttemptsTimeline attempts={r.attemptsLog} compact />
                )}
                {r.childRunIds?.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.childRunIds.map((id, i) => (
                      <Link
                        key={id}
                        to={wp(`/runs/${id}`)}
                        className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700 hover:underline dark:bg-indigo-950 dark:text-indigo-300"
                      >
                        ↗ {r.childRunIds.length > 1 ? `#${i}` : 'child run'}
                      </Link>
                    ))}
                  </div>
                )}
                {typeof r.queuedMs === 'number' && r.queuedMs > 50 && (
                  <p className="mt-1 text-[10px] text-slate-400">waited {r.queuedMs}ms for a queue slot</p>
                )}
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
              <div key={i} className={logLineClass(l.line)}>
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
