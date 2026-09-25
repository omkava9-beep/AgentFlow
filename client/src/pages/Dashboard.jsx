import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { listWorkflows, createWorkflow, deleteWorkflow } from '../api/workflows';
import { apiErrorMessage } from '../api/client';
import { Button, ErrorText } from '../components/ui';
import WorkflowCard from '../components/WorkflowCard';
import { useWorkspacePath } from '../hooks/useWorkspacePath';
import { useCan } from '../hooks/useCan';
import OnboardingChecklist from '../components/OnboardingChecklist';
import { confirm } from '../components/ui/confirm';
import { SkeletonGrid } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export default function Dashboard() {
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const wp = useWorkspacePath();
  const canEdit = useCan('workflow:edit');
  useDocumentTitle('Dashboard');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await listWorkflows();
      setWorkflows(data);
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load workflows'));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    setCreating(true);
    try {
      const wf = await createWorkflow('Untitled workflow');
      navigate(wp(`/workflows/${wf._id}`));
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to create workflow'));
      setCreating(false);
    }
  }

  async function handleDelete(id) {
    if (!(await confirm({ title: 'Delete this workflow?', body: 'Its versions, runs and comments go with it. This cannot be undone.', confirmLabel: 'Delete workflow', destructive: true }))) return;
    try {
      await deleteWorkflow(id);
      setWorkflows((wfs) => wfs.filter((w) => w._id !== id));
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to delete workflow'));
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Your Workflows</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Build, run, and monitor agent workflows.</p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Link
              to={wp('/templates')}
              className="rounded-lg border border-slate-200 bg-white/60 px-4 py-2 text-sm font-medium text-slate-700 backdrop-blur-sm transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              New from template
            </Link>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? 'Creating...' : '+ New Workflow'}
            </Button>
          </div>
        )}
      </div>

      <OnboardingChecklist />

      <ErrorText>{error}</ErrorText>

      {loading ? (
        <SkeletonGrid count={6} />
      ) : workflows.length === 0 ? (
        <EmptyState
          icon="🧩"
          title="No workflows yet"
          body={canEdit
            ? 'A workflow wires agents, tools and integrations into a graph you can run, schedule or trigger from outside.'
            : 'Nobody has built a workflow in this workspace yet.'}
          action={canEdit && (
            <Button onClick={handleCreate} disabled={creating}>{creating ? 'Creating...' : '+ New Workflow'}</Button>
          )}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workflows.map((wf) => (
            <WorkflowCard key={wf._id} workflow={wf} onDelete={canEdit ? handleDelete : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}
