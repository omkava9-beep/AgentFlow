import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow';
import 'reactflow/dist/style.css';
import { useWorkflowStore } from '../store/workflowStore';
import { getWorkflow, updateWorkflow, createRun } from '../api/workflows';
import { listTools } from '../api/tools';
import { apiErrorMessage } from '../api/client';
import { validateGraph } from '../utils/validateGraph';
import { useCanvasShortcuts } from '../hooks/useCanvasShortcuts';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { nodeTypes } from '../components/nodes';
import NodePalette from '../components/NodePalette';
import NodeConfigPanel from '../components/NodeConfigPanel';
import EdgeInspector from '../components/EdgeInspector';
import TriggerPanel from '../components/TriggerPanel';
import ValidationPanel from '../components/ValidationPanel';
import SaveAsTemplateDialog from '../components/SaveAsTemplateDialog';
import ShareDialog from '../components/ShareDialog';
import { Button } from '../components/ui';

const SELECTED_EDGE_STYLE = { stroke: '#6366f1', strokeWidth: 3 };

export default function Builder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const store = useWorkflowStore();
  const { nodes, edges, name, dirty, selectedNodeId, selectedEdgeId, lastError, past, future, clipboard, shareToken } = store;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [serverError, setServerError] = useState('');
  const [tools, setTools] = useState(null);
  const [templateDialog, setTemplateDialog] = useState(false);
  const [shareDialog, setShareDialog] = useState(false);

  useCanvasShortcuts();
  useUnsavedChangesGuard(dirty, 'You have unsaved changes to this workflow. Leave anyway?');

  useEffect(() => {
    setLoading(true);
    getWorkflow(id)
      .then((wf) => store.loadWorkflow(wf))
      .catch((err) => setServerError(apiErrorMessage(err, 'Failed to load workflow')))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    listTools()
      .then(({ tools: list }) => setTools(list))
      .catch(() => setTools(null));
  }, []);

  const onConnect = useCallback((connection) => store.connect(connection), []);

  const { errors, warnings } = useMemo(
    () => validateGraph({ nodes, edges, tools }),
    [nodes, edges, tools],
  );

  const decoratedEdges = useMemo(
    () => edges.map((e) => (e.id === selectedEdgeId ? { ...e, style: SELECTED_EDGE_STYLE } : e)),
    [edges, selectedEdgeId],
  );

  function handleAddNode(type) {
    store.addNode(type, { x: 100 + Math.random() * 300, y: 100 + Math.random() * 300 });
  }

  function revealNode(nodeId) {
    if (nodeId) store.focusNode(nodeId);
  }

  async function handleSave() {
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

  // Saving is permissive so an in-progress graph can be parked; running is strict.
  const saveBlocked = errors.length > 0;
  const runBlocked = saveBlocked || warnings.length > 0 || dirty;
  const runBlockedReason = dirty
    ? 'Save your changes before running.'
    : saveBlocked
      ? 'Fix the errors below before running.'
      : warnings.length
        ? 'Resolve the warnings below before running.'
        : undefined;

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100vh-57px)]">
      <div className="w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
        <input
          value={name}
          onChange={(e) => store.setName(e.target.value)}
          className="mb-4 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        <NodePalette onAdd={handleAddNode} />
        <div className="my-4 border-t border-slate-200 dark:border-slate-800" />
        <TriggerPanel workflowId={id} />
      </div>

      <div className="relative flex-1">
        <div className="absolute left-4 top-4 z-10 flex flex-wrap items-center gap-2">
          <Button onClick={handleSave} disabled={saving || saveBlocked} title={saveBlocked ? 'Fix the errors below before saving.' : undefined}>
            {saving ? 'Saving...' : dirty ? 'Save*' : 'Save'}
          </Button>
          <Button variant="secondary" onClick={handleRun} disabled={running || runBlocked} title={runBlockedReason}>
            {running ? 'Starting...' : '▶ Run'}
          </Button>

          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white/60 p-1 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/60">
            <IconAction onClick={store.undo} disabled={!past.length} title="Undo (⌘Z)" label="↺" />
            <IconAction onClick={store.redo} disabled={!future.length} title="Redo (⇧⌘Z)" label="↻" />
            <IconAction
              onClick={store.duplicateSelection}
              disabled={!nodes.some((n) => n.selected)}
              title="Duplicate selection (⌘D)"
              label="⧉"
            />
            <IconAction
              onClick={store.paste}
              disabled={!clipboard?.nodes?.length}
              title="Paste (⌘V)"
              label="⇤"
            />
          </div>

          <Button variant="secondary" onClick={() => setShareDialog(true)}>
            {shareToken ? 'Share · on' : 'Share'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setTemplateDialog(true)}
            disabled={dirty}
            title={dirty ? 'Save your changes first — a template snapshots the saved graph.' : undefined}
          >
            Save as template
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
          edges={decoratedEdges}
          onNodesChange={store.onNodesChange}
          onEdgesChange={store.onEdgesChange}
          onConnect={onConnect}
          onNodeDragStart={store.beginGesture}
          onNodeDragStop={store.endGesture}
          onNodeClick={(_, node) => store.selectNode(node.id)}
          onEdgeClick={(_, edge) => store.selectEdge(edge.id)}
          onPaneClick={() => {
            store.selectNode(null);
            store.selectEdge(null);
          }}
          nodeTypes={nodeTypes}
          // Deletion goes through the store so it lands in the undo stack.
          deleteKeyCode={null}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable className="!bg-white dark:!bg-slate-900" />
        </ReactFlow>

        <ValidationPanel errors={errors} warnings={warnings} onSelectNode={revealNode} />
      </div>

      {shareDialog && (
        <ShareDialog
          workflowId={id}
          initialToken={shareToken}
          onTokenChange={store.setShareToken}
          onClose={() => setShareDialog(false)}
        />
      )}

      {templateDialog && (
        <SaveAsTemplateDialog workflowId={id} defaultName={name} onClose={() => setTemplateDialog(false)} />
      )}

      {selectedNodeId && <NodeConfigPanel />}
      {selectedEdgeId && <EdgeInspector />}
    </div>
  );
}

function IconAction({ onClick, disabled, title, label }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded px-2 py-1 text-sm text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {label}
    </button>
  );
}
