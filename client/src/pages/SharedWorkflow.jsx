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
  // spec/30: a link to a workflow that has never been published shows nothing
  // of the draft, just says so.
  const [notPublished, setNotPublished] = useState(false);

  useEffect(() => {
    getSharedWorkflow(shareToken)
      .then(setData)
      .catch((err) => (err?.response?.data?.notPublished ? setNotPublished(true) : setNotFound(true)));
  }, [shareToken]);

  if (notPublished) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="max-w-md p-8 text-center">
          <h1 className="text-lg font-semibold text-fg">Not published yet</h1>
          <p className="mt-2 text-sm text-muted">
            This workflow hasn't been published yet. The link will show it once its owner publishes a version.
          </p>
        </Card>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="max-w-md p-8 text-center">
          <h1 className="text-lg font-semibold text-fg">Link not found</h1>
          <p className="mt-2 text-sm text-muted">
            This share link is no longer valid. The owner may have disabled it or generated a new one.
          </p>
          <Link to="/login" className="mt-4 inline-block text-sm text-accent hover:underline">
            Go to AgentFlow
          </Link>
        </Card>
      </div>
    );
  }

  if (!data) return <p className="p-6 text-sm text-muted">Loading shared workflow...</p>;

  const { workflow, runs } = data;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-default bg-surface/80 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Wordmark className="text-sm" />
            <span className="h-4 w-px bg-[rgb(var(--border))]" aria-hidden="true" />
            <span className="truncate text-sm font-medium text-fg">{workflow.name}</span>
            <span className="shrink-0 rounded-full bg-bg-subtle px-2 py-0.5 text-2xs font-medium text-muted ring-1 ring-inset ring-zinc-900/5 dark:ring-white/10">
              Read-only
            </span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <p className="mb-4 text-sm text-muted">
          Shared view of a workflow design and its recent runs. Last updated {formatRelativeTime(workflow.updatedAt)}.
        </p>

        <Card className="h-[420px] overflow-hidden p-0">
          <RunGraphView workflow={workflow} nodeResults={[]} />
        </Card>

        <h2 className="mb-2 mt-8 text-sm font-semibold text-fg">Recent runs</h2>
        {runs.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted">
            This workflow hasn't run yet.
          </Card>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => {
              const row = (
              <Card className={`flex items-center justify-between p-3 ${run.openable ? 'transition hover:border-strong' : ''}`}>
                <div className="flex items-center gap-3">
                  <StatusBadge status={run.status} />
                  <TriggerBadge trigger={run.trigger} />
                  <span className="text-sm text-muted">
                    {run.startedAt ? new Date(run.startedAt).toLocaleString() : 'Not started'}
                  </span>
                </div>
                <span className="text-xs tabular-nums text-subtle">
                  {run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'}
                </span>
              </Card>
              );
              // spec/35 §4: published root runs open a read-only detail view.
              return run.openable
                ? <Link key={run.id} to={`/shared/${shareToken}/runs/${run.id}`} className="block">{row}</Link>
                : <div key={run.id} title="Test runs of an unpublished draft can't be opened from a share link">{row}</div>;
            })}
          </div>
        )}
      </main>
    </div>
  );
}
