import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getSharedRun } from '../api/share';
import RunGraphView from '../components/RunGraphView';
import TriggerBadge from '../components/TriggerBadge';
import RunGantt from '../components/runs/RunGantt';
import AttemptsTimeline from '../components/runs/AttemptsTimeline';
import { Card, StatusBadge } from '../components/ui';
import { Wordmark } from '../components/Logo';
import ThemeToggle from '../components/ThemeToggle';
import { formatDuration } from '../utils/format';

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
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="max-w-md p-8 text-center">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Run not found</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">This run isn't available through this link.</p>
          <Link to={`/shared/${shareToken}`} className="mt-4 inline-block text-sm text-brand-600 hover:underline dark:text-brand-400">
            Back to the shared workflow
          </Link>
        </Card>
      </div>
    );
  }
  if (!data) return <p className="p-6 text-sm text-slate-500 dark:text-slate-400">Loading run...</p>;

  const { run, graph, nodes } = data;
  const labels = new Map((graph.nodes || []).map((n) => [n.id, n.data?.config?.label || n.id]));
  const labelOf = (id) => labels.get(id) || id;
  const asRun = { ...run, nodeResults: nodes };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/70 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Wordmark className="text-lg" />
            <Link to={`/shared/${shareToken}`} className="text-sm text-brand-600 hover:underline dark:text-brand-400">← Workflow</Link>
            <StatusBadge status={run.status} />
            <TriggerBadge trigger={run.trigger} />
            {run.versionNumber && <span className="text-xs text-slate-500">v{run.versionNumber}</span>}
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              Read-only
            </span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
          {run.startedAt ? `Started ${new Date(run.startedAt).toLocaleString()}` : 'Not started'}
          {run.durationMs != null && ` · took ${formatDuration(run.durationMs)}`}
        </p>
        <div className="mb-2 flex gap-1 text-xs">
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
        <Card className="h-[420px] overflow-hidden p-0">
          {view === 'graph'
            ? <RunGraphView workflow={graph} nodeResults={nodes} />
            : <RunGantt run={asRun} labelOf={labelOf} />}
        </Card>

        <h2 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-slate-400">Nodes</h2>
        <div className="space-y-2">
          {nodes.map((n) => (
            <Card key={n.nodeId} className="p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-700 dark:text-slate-200">{labelOf(n.nodeId)}</span>
                <div className="flex items-center gap-1.5">
                  {n.routing?.taken !== undefined && <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] text-brand-700 dark:bg-brand-950 dark:text-brand-300">took {String(n.routing.taken)}</span>}
                  {n.routing?.handoffTarget && <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] text-brand-700 dark:bg-brand-950 dark:text-brand-300">⇄ {n.routing.handoffTarget}</span>}
                  {n.routing?.approval && <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] text-orange-700 dark:bg-orange-950 dark:text-orange-300">{n.routing.approval}</span>}
                  {n.reused && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800">⟲ reused</span>}
                  {n.handled && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">handled</span>}
                  {n.cached && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-950 dark:text-blue-300">cached</span>}
                  <span className="text-slate-400">{formatDuration(n.durationMs)}</span>
                  <StatusBadge status={n.status} />
                </div>
              </div>
              {n.summary && <p className="mt-1 text-slate-500 dark:text-slate-400">{n.summary}</p>}
              {n.attemptsLog?.length > 1 && <AttemptsTimeline attempts={n.attemptsLog} compact />}
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
