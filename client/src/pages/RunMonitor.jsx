import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Ban, ChevronRight, GitBranch, Hourglass, Network, ScrollText, Search, AlertTriangle, Wrench, ArrowDownToLine,
  ArrowUpFromLine, Layers, Timer,
} from 'lucide-react';
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
import {
  StatusBadge, Button, Badge, Tabs, Segmented, Tooltip, CopyButton, Input, Select, EmptyState, NodeTypeIcon, IntegrationLogo, Skeleton, cx,
} from '../components/ui';
import ApprovalBanner from '../components/ApprovalBanner';
import VersionBadge from '../components/versions/VersionBadge';
import { useIntegrationStore } from '../store/integrationStore';
import RunOpsActions from '../components/runs/RunOpsActions';
import RunLineage from '../components/runs/RunLineage';
import AttemptsTimeline from '../components/runs/AttemptsTimeline';
import RunGantt from '../components/runs/RunGantt';
import JsonView from '../components/runs/JsonView';
import { RelativeTime, Duration } from '../components/runs/RunBits';
import { formatDuration } from '../utils/format';
import { useBreadcrumb } from '../store/breadcrumbStore';
import { shortId } from '../utils/runIds';

// `waiting` (spec/32) is still active: it can be cancelled, and it will continue.
const ACTIVE_STATUSES = ['pending', 'running', 'waiting'];

/** Simulated failures are expected, not bugs - phrase them as such visually. */
function logTone(line) {
  if (line.includes('[simulated failure]')) return 'text-warning';
  if (line.includes('retrying in')) return 'text-warning/80';
  if (/\b(error|failed|Error)\b/.test(line) && !line.includes('[error-branch]')) return 'text-danger';
  if (line.startsWith('[condition]') || line.startsWith('[handoff]')) return 'text-accent';
  if (line.startsWith('[error-branch]')) return 'text-warning';
  if (line.startsWith('[loop]') || line.startsWith('[subworkflow]')) return 'text-info';
  return 'text-muted';
}

/** One node's result in the side panel. */
function NodeResultRow({ r, node, labelOf, wp, catalog, defaultOpen = false }) {
  const [showOutput, setShowOutput] = useState(defaultOpen);
  const config = node?.data?.config || {};
  const integration = r.integration || config.integration;
  const manifest = integration ? catalog?.find((i) => i.id === integration) : null;
  const actionName = manifest?.actions?.find((a) => a.id === (r.action || config.action))?.name;
  const subtitle = node?.type === 'tool' && manifest ? `${manifest.name}${actionName ? ` · ${actionName}` : ''}` : node?.type;
  const failed = r.status === 'failed' && !r.handled;
  const lastLog = (r.logs || []).at(-1);
  const hasOutput = r.output !== undefined && r.output !== null;
  const hasBadges = Boolean(r.mode || r.cached || r.reused || r.attempts > 1 || r.toolCalls?.length || r.handoffTarget || r.progress
    || (r.waiting && r.status === 'running') || (typeof r.queuedMs === 'number' && r.queuedMs > 50) || hasOutput);

  return (
    <li className={cx('rounded-card border bg-surface p-3', failed ? 'border-danger/40' : 'border-default')}>
      <div className="flex items-start gap-2.5">
        {node?.type === 'tool' && integration
          ? <IntegrationLogo id={integration} />
          : <NodeTypeIcon type={node?.type || 'tool'} tile />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-fg">{labelOf(r.nodeId)}</p>
            <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-subtle">
              {r.durationMs != null && <span className="whitespace-nowrap tabular-nums">{formatDuration(r.durationMs)}</span>}
              <StatusBadge size="xs" status={r.handled ? 'handled' : r.status} label={r.skipReason === 'disabled' ? 'Disabled · passed through' : undefined} />
            </span>
          </div>
          {subtitle && <p className="truncate text-xs capitalize text-subtle">{subtitle}</p>}
          {hasBadges && <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {r.mode && (
              <Tooltip content={r.integration ? `${r.integration}.${r.action} ran ${r.mode}` : `Ran ${r.mode}`}>
                <span className="inline-flex"><Badge size="xs" tone={r.mode === 'live' ? 'success' : 'neutral'} dot>{r.mode === 'live' ? 'Live' : r.mode === 'sandbox' ? 'Sandbox' : r.mode}</Badge></span>
              </Tooltip>
            )}
            {r.cached && <Badge size="xs" tone="info">Cached</Badge>}
            {r.reused && <Tooltip content="Reused from the original run - not executed again (spec/35)"><span className="inline-flex"><Badge size="xs">Reused</Badge></span></Tooltip>}
            {r.attempts > 1 && <Badge size="xs" tone="warning">Attempt {r.attempts}</Badge>}
            {r.toolCalls?.length > 0 && (
              <Tooltip content="Tool calls this agent made">
                <span className="inline-flex" data-testid="tool-call-count"><Badge size="xs" tone="accent" icon={Wrench}>{r.toolCalls.length}</Badge></span>
              </Tooltip>
            )}
            {r.handoffTarget && <Badge size="xs" tone="accent" icon={GitBranch}>{r.handoffTarget}</Badge>}
            {r.progress && <Badge size="xs" tone="info" icon={Layers}>{r.progress.done} / {r.progress.total}</Badge>}
            {r.waiting && r.status === 'running' && (
              <Badge size="xs" icon={Hourglass}>Waiting for a slot ({r.waitReason === 'cap' ? 'workspace cap' : 'shared pool'})</Badge>
            )}
            {typeof r.queuedMs === 'number' && r.queuedMs > 50 && <Badge size="xs" icon={Timer}>Queued {r.queuedMs} ms</Badge>}
            {hasOutput && (
              <button type="button" onClick={() => setShowOutput((v) => !v)} aria-expanded={showOutput} className="ml-auto inline-flex items-center gap-1 rounded px-1 text-xs font-medium text-muted hover:bg-bg-subtle hover:text-fg">
                <ChevronRight className={cx('h-3 w-3 transition-transform', showOutput && 'rotate-90')} aria-hidden="true" />
                Output
              </button>
            )}
          </div>}
          {failed && lastLog && <p className="mt-2 rounded-control bg-danger-subtle px-2 py-1.5 font-mono text-2xs text-danger-subtle-fg">{lastLog}</p>}
          {r.toolCalls?.length > 0 && <ToolCallTimeline calls={r.toolCalls} agentSteps={r.agentSteps} finished={r.status === 'success'} />}
          {(r.attemptsLog?.length > 1 || r.attemptsLog?.some((a) => a.outcome === 'failed')) && <AttemptsTimeline attempts={r.attemptsLog} compact />}
          {r.childRunIds?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {r.childRunIds.map((id, i) => (
                <Link key={id} to={wp(`/runs/${id}`)} className="inline-flex hover:opacity-80">
                  <Badge size="xs" icon={Network}>{r.childRunIds.length > 1 ? `#${i}` : 'Child run'}</Badge>
                </Link>
              ))}
            </div>
          )}
          {hasOutput && showOutput && <div className="mt-2"><JsonView value={r.output} maxHeight="max-h-72" /></div>}
        </div>
      </div>
    </li>
  );
}

export default function RunMonitor() {
  const { runId } = useParams();
  const wp = useWorkspacePath();
  const { run, logs, queueStats, loadError } = useRunSocket(runId);
  const [workflow, setWorkflow] = useState(null);
  useBreadcrumb(runId ? `Run ${shortId(runId)}` : null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');
  // spec/35 §6: the run-level Timeline view sits beside Graph.
  const [view, setView] = useState('graph');
  const [panel, setPanel] = useState('nodes');
  const [logQuery, setLogQuery] = useState('');
  const [logNode, setLogNode] = useState('');
  const loadCatalog = useIntegrationStore((s) => s.loadCatalog);
  const catalog = useIntegrationStore((s) => s.catalog);
  const [, tick] = useState(0);

  // Only for integration names and icons; ids render without it.
  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  useEffect(() => {
    if (run?.workflowId) getWorkflow(run.workflowId).then(setWorkflow).catch(() => {});
  }, [run?.workflowId]);
  // A live run's elapsed time ticks.
  const isActive = ACTIVE_STATUSES.includes(run?.status);
  useEffect(() => {
    if (!isActive) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [isActive]);

  // spec/30 §2: draw the graph this run executed (its version, or its draft
  // snapshot), never today's draft. Runs from before versioning recorded
  // neither, so they fall back to the current workflow with a note.
  const graphWorkflow = useMemo(() => (run?.graph
    ? { ...(workflow || {}), name: run.graph.name ?? workflow?.name, nodes: run.graph.nodes, edges: run.graph.edges }
    : workflow), [run?.graph, workflow]);
  const nodesById = useMemo(() => new Map((graphWorkflow?.nodes || []).map((n) => [n.id, n])), [graphWorkflow]);
  const labelOf = (id) => nodesById.get(id)?.data?.config?.label || id;

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
    return <div className="p-10"><EmptyState icon={Ban} title="You no longer have access to this run" body="Your role in this workspace changed, or you were removed." /></div>;
  }
  if (loadError && !run) return <div className="p-10"><EmptyState icon={AlertTriangle} title="Failed to load run" body="Check your connection and reload the page." /></div>;
  if (!run) {
    return (
      <div className="flex h-[calc(100vh-var(--topbar-h))] flex-col">
        <div className="flex items-center gap-3 border-b border-default px-4 py-3"><Skeleton className="h-5 w-64" /><Skeleton className="h-5 w-24" /></div>
        <div className="flex flex-1"><div className="flex-1" /><div className="w-[26rem] space-y-2 border-l border-default p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div></div>
      </div>
    );
  }

  const results = run.nodeResults || [];
  const failedCount = results.filter((r) => r.status === 'failed' && !r.handled).length;
  const endNode = (graphWorkflow?.nodes || []).find((n) => n.type === 'end');
  const finalOutput = endNode ? results.find((r) => r.nodeId === endNode.id)?.output : undefined;
  const elapsed = run.startedAt ? (run.finishedAt ? new Date(run.finishedAt) - new Date(run.startedAt) : null) : null;
  const shownLogs = logs.filter((l) => (!logNode || l.nodeId === logNode) && (!logQuery || l.line.toLowerCase().includes(logQuery.toLowerCase())));

  return (
    <div className="flex h-[calc(100vh-var(--topbar-h))] flex-col">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-default bg-surface px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          {workflow ? (
            <Link to={wp(`/workflows/${workflow._id}`)} className="inline-flex min-w-0 items-center gap-1.5 text-sm text-muted hover:text-fg">
              <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate font-medium text-fg">{workflow.name}</span>
            </Link>
          ) : <Skeleton className="h-4 w-32" />}
          <span className="inline-flex items-center gap-1 font-mono text-xs text-subtle">
            {shortId(run._id)}<CopyButton value={String(run._id)} />
          </span>
          <StatusBadge status={run.failReason === 'interrupted' ? 'interrupted' : run.status} />
          <TriggerBadge trigger={run.trigger} apiKeyName={run.apiKeyName} test={run.input?.test === true} />
          <VersionBadge isDraft={run.isDraft} versionNumber={run.versionNumber} long />
          {run.parentRunId && (
            // spec/31: a child run links back up its lineage.
            <span className="inline-flex items-center gap-1">
              {run.rootRunId && String(run.rootRunId) !== String(run.parentRunId) && (
                <Link to={wp(`/runs/${run.rootRunId}`)} className="inline-flex hover:opacity-80"><Badge size="xs">Root run</Badge></Link>
              )}
              <Link to={wp(`/runs/${run.parentRunId}`)} className="inline-flex hover:opacity-80">
                <Badge size="xs" tone="accent" icon={Network}>Parent run{run.iteration !== null && run.iteration !== undefined ? ` · item ${run.iteration}` : ''}</Badge>
              </Link>
            </span>
          )}
          <RunLineage run={run} labelOf={labelOf} linkTo={(id) => wp(`/runs/${id}`)} currentVersion={workflow?.publishedVersion} />
          {!run.graph && workflow && (
            <Tooltip content="This run predates versioning, so it's drawn against the current workflow.">
              <span className="inline-flex"><Badge size="xs" tone="warning">Pre-versioning run</Badge></span>
            </Tooltip>
          )}
          {run.cancelReason === 'timeout' && <Badge size="xs" tone="warning" icon={Timer}>Timed out</Badge>}
        </div>
        <div className="flex items-center gap-3">
          {isActive && <QueueIndicator stats={queueStats} />}
          <div className="text-right text-xs leading-tight text-subtle">
            <div>Started <RelativeTime value={run.startedAt || run.createdAt} className="text-muted" /></div>
            <div>{run.finishedAt ? 'Took ' : 'Running for '}<span className="text-muted"><Duration ms={elapsed} running={isActive} startedAt={run.startedAt} /></span></div>
          </div>
          <RunOpsActions run={run} labelOf={labelOf} />
          {isActive && (
            <Button size="sm" variant="danger-ghost" icon={Ban} loading={cancelling} onClick={handleCancel}>Cancel run</Button>
          )}
          {cancelError && <span className="text-xs text-danger">{cancelError}</span>}
        </div>
      </header>

      <ApprovalBanner run={run} />

      <div className="flex min-h-0 flex-1">
        {/* Canvas */}
        <div className="relative min-w-0 flex-1 bg-bg">
          <div className="absolute left-3 top-3 z-10">
            <Segmented
              aria-label="View"
              value={view}
              onChange={setView}
              items={[{ value: 'graph', label: 'Graph', icon: Network }, { value: 'timeline', label: 'Timeline', icon: Layers }]}
            />
          </div>
          {view === 'graph'
            ? <RunGraphView workflow={graphWorkflow} nodeResults={results} />
            : <div className="h-full pt-12"><RunGantt run={run} labelOf={labelOf} /></div>}
        </div>

        {/* Side panel */}
        <aside className="flex w-[26rem] shrink-0 flex-col border-l border-default bg-surface">
          <div className="px-4 pt-2">
            <Tabs
              value={panel}
              onChange={setPanel}
              size="sm"
              items={[
                { value: 'nodes', label: 'Nodes', icon: Layers, count: results.length },
                { value: 'logs', label: 'Logs', icon: ScrollText, count: logs.length },
                { value: 'input', label: 'Input', icon: ArrowDownToLine },
                { value: 'output', label: 'Output', icon: ArrowUpFromLine },
              ]}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {panel === 'nodes' && (
              <>
                {failedCount > 0 && (
                  <p className="mb-3 flex items-center gap-2 rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                    {failedCount} node{failedCount === 1 ? '' : 's'} failed
                  </p>
                )}
                <ul className="space-y-2">
                  {results.map((r) => (
                    <NodeResultRow
                      key={r.nodeId}
                      r={r}
                      node={nodesById.get(r.nodeId)}
                      labelOf={labelOf}
                      wp={wp}
                      catalog={catalog}
                      // The run's result is what you came for: the End node's output
                      // opens by default, and every output does on a small run.
                      defaultOpen={nodesById.get(r.nodeId)?.type === 'end' || results.length <= 4}
                    />
                  ))}
                </ul>
              </>
            )}
            {panel === 'logs' && (
              <div className="flex h-full flex-col">
                <div className="mb-3 flex gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" aria-hidden="true" />
                    <Input size="sm" value={logQuery} onChange={(e) => setLogQuery(e.target.value)} placeholder="Filter logs…" aria-label="Filter logs" className="pl-8" />
                  </div>
                  <div className="w-40 shrink-0"><Select
                    size="sm"
                    aria-label="Node"
                    value={logNode}
                    onValueChange={setLogNode}
                    options={[{ value: '', label: 'All nodes' }, ...results.map((r) => ({ value: r.nodeId, label: labelOf(r.nodeId) }))]}
                  /></div>
                </div>
                {shownLogs.length === 0 ? (
                  <EmptyState compact icon={ScrollText} title={logs.length ? 'No matching log lines' : 'No logs yet'} body={logs.length ? 'Try another filter.' : 'Lines stream in as nodes run.'} />
                ) : (
                  <ol className="space-y-px rounded-control border border-default bg-surface-sunken p-2 font-mono text-2xs leading-relaxed">
                    {shownLogs.map((l, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="w-24 shrink-0 truncate text-subtle">{labelOf(l.nodeId)}</span>
                        <span className={cx('min-w-0 break-words', logTone(l.line))}>{l.line}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
            {panel === 'input' && (
              <JsonView value={run.input} emptyTitle="No input" emptyBody="This run started without a payload." />
            )}
            {panel === 'output' && (
              <JsonView
                value={finalOutput}
                emptyTitle={isActive ? 'Not finished yet' : 'No final output'}
                emptyBody={isActive ? 'The End node’s output appears here when the run completes.' : 'The End node didn’t produce an output on this run.'}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
