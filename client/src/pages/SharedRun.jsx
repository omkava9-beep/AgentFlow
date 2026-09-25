import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Eye, Network, Layers, SearchX, GitBranch, UserCheck, Repeat2 } from 'lucide-react';
import { getSharedRun } from '../api/share';
import RunGraphView from '../components/RunGraphView';
import TriggerBadge from '../components/TriggerBadge';
import RunGantt from '../components/runs/RunGantt';
import AttemptsTimeline from '../components/runs/AttemptsTimeline';
import { Card, StatusBadge, Badge, Segmented, DataTable, EmptyState, Skeleton, NodeTypeIcon } from '../components/ui';
import { Wordmark } from '../components/Logo';
import ThemeToggle from '../components/ThemeToggle';
import { formatDuration } from '../utils/format';
import { RelativeTime } from '../components/runs/RunBits';

/**
 * spec/35 §4: one run behind a share link. Only what the server's whitelist
 * sends - statuses, timings, attempts and routing; never input, outputs, logs
 * or error text - and nothing on the page can start or change a run.
 */
export default function SharedRun() {
  const { shareToken, runId } = useParams();
  const [data, setData] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [view, setView] = useState('graph');

  useEffect(() => {
    getSharedRun(shareToken, runId).then(setData).catch(() => setNotFound(true));
  }, [shareToken, runId]);

  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-subtle p-6">
        <Card className="max-w-md p-8">
          <EmptyState
            icon={SearchX}
            title="Run not found"
            body="This run isn't available through this link."
            action={<Link to={`/shared/${shareToken}`} className="text-sm font-medium text-accent hover:underline">Back to the shared workflow</Link>}
          />
        </Card>
      </div>
    );
  }

  const run = data?.run;
  const graph = data?.graph;
  const nodes = data?.nodes || [];
  const nodesById = new Map((graph?.nodes || []).map((n) => [n.id, n]));
  const labelOf = (id) => nodesById.get(id)?.data?.config?.label || id;
  const asRun = run ? { ...run, nodeResults: nodes } : null;

  const columns = [
    {
      key: 'node', header: 'Node',
      cell: (n) => (
        <span className="inline-flex min-w-0 items-center gap-2">
          <NodeTypeIcon type={nodesById.get(n.nodeId)?.type || 'tool'} size="sm" />
          <span className="truncate font-medium">{labelOf(n.nodeId)}</span>
        </span>
      ),
    },
    { key: 'status', header: 'Status', cell: (n) => <StatusBadge size="xs" status={n.handled ? 'handled' : n.status} /> },
    {
      key: 'routing', header: 'Routing',
      cell: (n) => (
        <span className="flex flex-wrap gap-1">
          {n.routing?.taken !== undefined && <Badge size="xs" tone="accent" icon={GitBranch}>took {String(n.routing.taken)}</Badge>}
          {n.routing?.handoffTarget && <Badge size="xs" tone="accent" icon={GitBranch}>{n.routing.handoffTarget}</Badge>}
          {n.routing?.approval && <Badge size="xs" tone="warning" icon={UserCheck}>{n.routing.approval}</Badge>}
          {n.reused && <Badge size="xs" icon={Repeat2}>Reused</Badge>}
          {n.cached && <Badge size="xs" tone="info">Cached</Badge>}
          {!n.routing && !n.reused && !n.cached && <span className="text-subtle">—</span>}
        </span>
      ),
    },
    {
      key: 'attempts', header: 'Attempts', width: 200,
      cell: (n) => (n.attemptsLog?.length > 1 ? <AttemptsTimeline attempts={n.attemptsLog} compact /> : <span className="tabular-nums text-subtle">{n.attempts || 1}</span>),
    },
    { key: 'duration', header: 'Duration', align: 'right', className: 'tabular-nums', cell: (n) => formatDuration(n.durationMs) },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="sticky top-0 z-20 border-b border-default bg-surface/80 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Wordmark className="text-base" />
            <span className="h-5 w-px bg-[rgb(var(--border))]" aria-hidden="true" />
            <Link to={`/shared/${shareToken}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />Workflow
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <Badge size="xs" icon={Eye}>Read-only</Badge>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {!run ? (
          <div className="space-y-4"><Skeleton className="h-8 w-80" /><Skeleton className="h-[420px] rounded-card" /></div>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight text-fg">{graph?.name || 'Run'}</h1>
              <StatusBadge status={run.status} />
              <TriggerBadge trigger={run.trigger} />
              {run.versionNumber && <Badge size="xs" tone="accent">v{run.versionNumber}</Badge>}
              <span className="text-sm text-muted">
                {run.startedAt ? <>Started <RelativeTime value={run.startedAt} /></> : 'Not started'}
                {run.durationMs != null && ` · took ${formatDuration(run.durationMs)}`}
              </span>
            </div>
            <Card className="relative mb-6 h-[420px] overflow-hidden">
              <div className="absolute left-3 top-3 z-10">
                <Segmented
                  aria-label="View"
                  value={view}
                  onChange={setView}
                  items={[{ value: 'graph', label: 'Graph', icon: Network }, { value: 'timeline', label: 'Timeline', icon: Layers }]}
                />
              </div>
              {view === 'graph'
                ? <RunGraphView workflow={graph} nodeResults={nodes} />
                : <div className="h-full pt-12"><RunGantt run={asRun} labelOf={labelOf} /></div>}
            </Card>
            <h2 className="mb-2 text-sm font-semibold text-fg">Nodes</h2>
            <DataTable dense columns={columns} rows={nodes} rowKey={(n) => n.nodeId} empty={{ icon: Layers, title: 'No nodes ran', compact: true }} />
          </>
        )}
      </main>
    </div>
  );
}
