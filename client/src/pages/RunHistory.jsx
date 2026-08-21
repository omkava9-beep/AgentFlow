import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { listRuns } from '../api/workflows';
import { getWorkflow } from '../api/workflows';
import { Card, StatusBadge } from '../components/ui';
import TriggerBadge from '../components/TriggerBadge';
import { apiErrorMessage } from '../api/client';

export default function RunHistory() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [workflow, setWorkflow] = useState(null);
  const [runs, setRuns] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    getWorkflow(id).then(setWorkflow).catch(() => {});
    listRuns(id)
      .then(setRuns)
      .catch((err) => setError(apiErrorMessage(err, 'Failed to load run history')));
  }, [id]);

  function openRun(run) {
    if (run.status === 'pending' || run.status === 'running') {
      navigate(`/runs/${run.id}`);
    } else {
      navigate(`/runs/${run.id}`);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <Link to={`/workflows/${id}`} className="text-sm text-brand-600 hover:underline dark:text-brand-400">
          ← {workflow?.name || 'Workflow'}
        </Link>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Run History</h1>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {runs.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
          No runs yet. Go back and hit Run to execute this workflow.
        </Card>
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
                <TriggerBadge trigger={r.trigger} />
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
