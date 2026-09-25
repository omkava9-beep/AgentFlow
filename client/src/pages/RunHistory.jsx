import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { listRuns } from '../api/workflows';
import { getWorkflow } from '../api/workflows';
import { Card, StatusBadge } from '../components/ui';
import TriggerBadge from '../components/TriggerBadge';
import VersionBadge from '../components/versions/VersionBadge';
import { apiErrorMessage, isNotFound } from '../api/client';
import { useWorkspacePath } from '../hooks/useWorkspacePath';
import ResourceNotFound from '../components/ResourceNotFound';
import { SkeletonTable } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';

export default function RunHistory() {
  const { id } = useParams();
  const navigate = useNavigate();
  const wp = useWorkspacePath();
  const [notFound, setNotFound] = useState(false);
  const [workflow, setWorkflow] = useState(null);
  const [runs, setRuns] = useState([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getWorkflow(id).then(setWorkflow).catch(() => {});
    listRuns(id)
      .then(setRuns)
      .catch((err) => {
        if (isNotFound(err)) setNotFound(true);
        else setError(apiErrorMessage(err, 'Failed to load run history'));
      })
      .finally(() => setLoaded(true));
  }, [id]);

  function openRun(run) {
    navigate(wp(`/runs/${run.id}`));
  }

  if (notFound) return <ResourceNotFound kind="workflow" />;

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <Link to={wp(`/workflows/${id}`)} className="text-sm text-brand-600 hover:underline dark:text-brand-400">
          ← {workflow?.name || 'Workflow'}
        </Link>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Run History</h1>
        {/* spec/35: the filterable Runs page and per-workflow analytics. */}
        <span className="ml-auto flex items-center gap-3 text-xs">
          <Link to={wp(`/runs?workflowId=${id}`)} className="text-brand-600 hover:underline dark:text-brand-400">Filter &amp; search runs</Link>
          <Link to={wp(`/analytics/workflows/${id}`)} className="text-brand-600 hover:underline dark:text-brand-400">Analytics for this workflow</Link>
        </span>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {!loaded ? (
        <SkeletonTable rows={6} columns={4} />
      ) : runs.length === 0 ? (
        <EmptyState
          icon="▶"
          title="No runs yet"
          body="Test-run the draft from the Builder, or publish it so its triggers can start runs."
          action={<Link to={wp(`/workflows/${id}`)} className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">Open the Builder</Link>}
        />
      ) : (
        <div className="space-y-2">
          {runs.map((r) => (
            <Card
              key={r.id}
              className="flex cursor-pointer items-center justify-between p-4 hover:border-brand-400"
              onClick={() => openRun(r)}
            >
              <div className="flex items-center gap-3">
                <StatusBadge status={r.status} />
                <TriggerBadge trigger={r.trigger} test={r.test === true} />
                <VersionBadge isDraft={r.isDraft} versionNumber={r.versionNumber} />
                <span className="text-sm text-slate-600 dark:text-slate-300">
                  {r.startedAt ? new Date(r.startedAt).toLocaleString() : 'Not started'}
                </span>
              </div>
              <span className="text-xs text-slate-400">
                {r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : '—'}
              </span>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
