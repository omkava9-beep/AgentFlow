import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getSharedWorkflow } from '../api/share';
import RunGraphView from '../components/RunGraphView';
import TriggerBadge from '../components/TriggerBadge';
import { Card, StatusBadge } from '../components/ui';
import { Wordmark } from '../components/Logo';
import ThemeToggle from '../components/ThemeToggle';
import { formatRelativeTime } from '../utils/time';

/**
 * The public read-only view (spec/18). No Layout wrapper — Layout carries the
 * app nav and a Logout button, neither of which means anything to someone who
 * isn't signed in. There is no edit affordance and no way to start a run.
 */
export default function SharedWorkflow() {
  const { shareToken } = useParams();
  const [data, setData] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    getSharedWorkflow(shareToken)
      .then(setData)
      .catch(() => setNotFound(true));
  }, [shareToken]);

  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="max-w-md p-8 text-center">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Link not found</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            This share link is no longer valid. The owner may have disabled it or generated a new one.
          </p>
          <Link to="/login" className="mt-4 inline-block text-sm text-brand-600 hover:underline dark:text-brand-400">
            Go to AgentFlow
          </Link>
        </Card>
      </div>
    );
  }

  if (!data) return <p className="p-6 text-sm text-slate-500 dark:text-slate-400">Loading shared workflow...</p>;

  const { workflow, runs } = data;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/70 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Wordmark className="text-lg" />
            <span className="truncate text-sm text-slate-600 dark:text-slate-300">{workflow.name}</span>
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              Read-only
            </span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          Shared view of a workflow design and its recent runs. Last updated {formatRelativeTime(workflow.updatedAt)}.
        </p>

        <Card className="h-[420px] overflow-hidden p-0">
          <RunGraphView workflow={workflow} nodeResults={[]} />
        </Card>

        <h2 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-slate-400">Recent runs</h2>
        {runs.length === 0 ? (
          <Card className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
            This workflow hasn't run yet.
          </Card>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => (
              <Card key={run.id} className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3">
                  <StatusBadge status={run.status} />
                  <TriggerBadge trigger={run.trigger} />
                  <span className="text-sm text-slate-600 dark:text-slate-300">
                    {run.startedAt ? new Date(run.startedAt).toLocaleString() : 'Not started'}
                  </span>
                </div>
                <span className="text-xs text-slate-400">
                  {run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'}
                </span>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
