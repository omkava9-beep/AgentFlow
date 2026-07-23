import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow';
import 'reactflow/dist/style.css';
import { useWorkflowStore } from '../store/workflowStore';
import { getWorkflow, updateWorkflow, createRun } from '../api/workflows';
import { apiErrorMessage } from '../api/client';
import { nodeTypes } from '../components/nodes';
import NodePalette from '../components/NodePalette';
import NodeConfigPanel from '../components/NodeConfigPanel';
import TriggerPanel from '../components/TriggerPanel';
import { Button, ErrorText } from '../components/ui';

export default function Builder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const store = useWorkflowStore();
  const { nodes, edges, name, dirty, selectedNodeId, lastError } = store;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [serverError, setServerError] = useState('');

  useEffect(() => {
    setLoading(true);
    getWorkflow(id)
      .then((wf) => store.loadWorkflow(wf))
      .catch((err) => setServerError(apiErrorMessage(err, 'Failed to load workflow')))
      .finally(() => setLoading(false));
  }, [id]);

  const onConnect = useCallback((connection) => store.connect(connection), []);

  function handleAddNode(type) {
    const position = { x: 100 + Math.random() * 300, y: 100 + Math.random() * 300 };
    store.addNode(type, position);
  }

  function validateGraph() {
    if (!nodes.length) return 'Add at least one node before saving.';
    if (!nodes.some((n) => n.type === 'start')) return 'Workflow needs a Start node.';
    return null;
  }

  async function handleSave() {
    const validationError = validateGraph();
    if (validationError) {
      setServerError(validationError);
      return;
    }
    setSaving(true);
    setServerError('');
    try {
      await updateWorkflow(id, { name, nodes, edges });
      store.markSaved();
    } catch (err) {
      setServerError(apiErrorMessage(err, 'Failed to save workflow'));
    } finally {
      setSaving(false);
    }
  }

  async function handleRun() {
    if (dirty) {
      setServerError('Save your changes before running.');
      return;
    }
    setRunning(true);
    setServerError('');
    try {
      const { runId } = await createRun(id);
      navigate(`/runs/${runId}`);
    } catch (err) {
      setServerError(apiErrorMessage(err, 'Failed to start run'));
    } finally {
      setRunning(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-500 dark:text-slate-400">Loading workflow...</p>;

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100vh-57px)]">
      <div className="w-56 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
        <input
          value={name}
          onChange={(e) => store.setName(e.target.value)}
          className="mb-4 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        <NodePalette onAdd={handleAddNode} />
        <div className="my-4 border-t border-slate-200 dark:border-slate-800" />
        <TriggerPanel />
      </div>

      <div className="relative flex-1">
        <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : dirty ? 'Save*' : 'Save'}
          </Button>
          <Button variant="secondary" onClick={handleRun} disabled={running || dirty}>
            {running ? 'Starting...' : '▶ Run'}
          </Button>
          <Link
            to={`/workflows/${id}/runs`}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            History
          </Link>
          {(serverError || lastError) && (
            <span className="rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600 dark:bg-red-950 dark:text-red-300">
              {serverError || lastError}
            </span>
          )}
        </div>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={store.onNodesChange}
          onEdgesChange={store.onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => store.selectNode(node.id)}
          onPaneClick={() => store.selectNode(null)}
          nodeTypes={nodeTypes}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable className="!bg-white dark:!bg-slate-900" />
        </ReactFlow>
      </div>

      {selectedNodeId && <NodeConfigPanel />}
    </div>
  );
}
