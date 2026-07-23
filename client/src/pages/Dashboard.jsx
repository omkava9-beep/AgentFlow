import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listWorkflows, createWorkflow, deleteWorkflow } from '../api/workflows';
import { apiErrorMessage } from '../api/client';
import { Card, Button, ErrorText } from '../components/ui';
import ComingSoonBadge from '../components/ComingSoonBadge';
import WorkflowCard from '../components/WorkflowCard';

export default function Dashboard() {
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

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
      navigate(`/workflows/${wf._id}`);
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to create workflow'));
      setCreating(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this workflow? This cannot be undone.')) return;
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
        <div className="flex items-center gap-2">
          <Button variant="secondary" disabled title="Coming soon">
            New from template <ComingSoonBadge />
          </Button>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? 'Creating...' : '+ New Workflow'}
          </Button>
        </div>
      </div>

      <ErrorText>{error}</ErrorText>

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading...</p>
      ) : workflows.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-slate-500 dark:text-slate-400">No workflows yet. Create your first one to get started.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workflows.map((wf) => (
            <WorkflowCard key={wf._id} workflow={wf} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
