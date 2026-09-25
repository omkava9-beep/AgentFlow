import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow';
import 'reactflow/dist/style.css';
import { useWorkflowStore } from '../store/workflowStore';
import { getWorkflow, createRun } from '../api/workflows';
import { useIntegrationStore } from '../store/integrationStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAuthStore } from '../store/authStore';
import { useToastStore } from '../store/toastStore';
import { apiErrorMessage, isNotFound } from '../api/client';
import { useWorkspacePath } from '../hooks/useWorkspacePath';
import { useCan } from '../hooks/useCan';
import ResourceNotFound from '../components/ResourceNotFound';
import { validateGraph } from '../utils/validateGraph';
import { useWorkspaceWorkflows } from '../hooks/useWorkspaceWorkflows';
import { useCanvasShortcuts } from '../hooks/useCanvasShortcuts';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { openWorkflowSession } from '../collab/transport';
import { usePresence, useCursorBroadcast } from '../collab/usePresence';
import { nodeTypes } from '../components/nodes';
import NodePalette from '../components/NodePalette';
import NodeConfigPanel from '../components/NodeConfigPanel';
import EdgeInspector from '../components/EdgeInspector';
import TriggerPanel from '../components/TriggerPanel';
import ValidationPanel from '../components/ValidationPanel';
import SaveAsTemplateDialog from '../components/SaveAsTemplateDialog';
import ShareDialog from '../components/ShareDialog';
import SaveStatus from '../components/SaveStatus';
import PresenceAvatars from '../components/PresenceAvatars';
import RemoteCursors from '../components/RemoteCursors';
import CommentsLayer from '../components/comments/CommentsLayer';
import WatchToggle from '../components/comments/WatchToggle';
import { Button } from '../components/ui';
import { Menu, MenuButton, MenuLink, MenuSeparator } from '../components/ui/Menu';
import { Skeleton } from '../components/ui/Skeleton';
import { CanvasErrorBoundary } from '../components/ui/ErrorBoundary';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useVersionState } from '../hooks/useVersionState';
import VersionChip from '../components/versions/VersionChip';
import RunSplitButton from '../components/versions/RunSplitButton';
import PublishDialog from '../components/versions/PublishDialog';
import VersionsDrawer from '../components/versions/VersionsDrawer';
import DiffView from '../components/versions/DiffView';

const ERROR_EDGE_STYLE = { stroke: '#ef4444', strokeWidth: 1.5, strokeDasharray: '6 4' };
const SELECTED_EDGE_STYLE = { stroke: '#6366f1', strokeWidth: 3 };

const formatResetAt = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'midnight UTC' : d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
};

export default function Builder() {
  const { id } = useParams();
  // Loop and sub-workflow nodes are validated against this workspace's workflows.
  const { workflows } = useWorkspaceWorkflows();
  const navigate = useNavigate();
  const wp = useWorkspacePath();
  const store = useWorkflowStore();
  const { nodes, edges, name, pendingCount, selectedNodeId, selectedEdgeId, lastError, past, future, clipboard, shareToken } = store;
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [serverError, setServerError] = useState('');
  const [templateDialog, setTemplateDialog] = useState(false);
  const [shareDialog, setShareDialog] = useState(false);
  const [notFound, setNotFound] = useState(false);
  // spec/33: after a 429 the Run button stays off until the daily quota resets.
  const [limitUntil, setLimitUntil] = useState(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const viewportRef = useRef(viewport);
  const canvasRef = useRef(null);
  const flowRef = useRef(null);
  const userId = useAuthStore((s) => s.user?.id);
  // Viewers get the canvas read-only (spec/23). The server enforces every one
  // of these regardless; this just doesn't offer what would be refused.
  const canEdit = useCan('workflow:edit');
  const canRun = useCan('workflow:run');
  const canShare = useCan('share:manage');
  const canTemplate = useCan('templates:create');
  const canTriggers = useCan('triggers:manage');
  const canPublish = useCan('workflow:publish');
  // spec/30: draft vs published.
  const versionState = useVersionState(id);
  const [publishOpen, setPublishOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [diffRange, setDiffRange] = useState(null); // { from, to } or null
  const [commentsSlot, setCommentsSlot] = useState(null);

  const workspaceName = useWorkspaceStore((s) => s.current?.name);
  useDocumentTitle(name ? `${name}${workspaceName ? ` · ${workspaceName}` : ''}` : null);
  useCanvasShortcuts({ enabled: canEdit });
  // Edits save themselves (spec/28 §9); only ops the server hasn't confirmed yet
  // are at risk when leaving.
  useUnsavedChangesGuard(pendingCount > 0 && canEdit, "Some changes haven't synced yet. Leave anyway?");

  useEffect(() => {
    useWorkflowStore.getState().setReadOnly(!canEdit);
  }, [canEdit]);

  // The latest values for handlers that must not re-trigger the load effect.
  const latest = useRef({ canEdit, navigate, wp });
  latest.current = { canEdit, navigate, wp };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    getWorkflow(id)
      .then((wf) => {
        // A superseded load (fast navigation, StrictMode's double effect) must
        // not replace the document a newer load - and the live session - own.
        if (cancelled) return;
        const s = useWorkflowStore.getState();
        s.loadWorkflow(wf);
        s.setReadOnly(!latest.current.canEdit);
      })
      .catch((err) => {
        if (cancelled) return;
        if (isNotFound(err)) setNotFound(true);
        else setServerError(apiErrorMessage(err, 'Failed to load workflow'));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Join the workflow's live session once it's loaded (spec/28 §7).
  useEffect(() => {
    if (loading || notFound) return undefined;
    return openWorkflowSession(id, {
      userId,
      onClosed: ({ by }) => {
        useToastStore.getState().push(`${by?.name || 'Someone'} deleted this workflow.`, 'error');
        latest.current.navigate(latest.current.wp('/dashboard'));
      },
    });
  }, [id, loading, notFound, userId]);

  useEffect(() => {
    if (!limitUntil) return undefined;
    const ms = new Date(limitUntil).getTime() - Date.now();
    if (!(ms > 0)) {
      setLimitUntil(null);
      return undefined;
    }
    const t = setTimeout(() => setLimitUntil(null), Math.min(ms, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [limitUntil]);

  // Track the canvas size for the presence overlay's off-screen test.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setCanvasSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]);

  const integrations = useIntegrationStore((s) => s.catalog);
  const connections = useIntegrationStore((s) => s.connections);
  const loadCatalog = useIntegrationStore((s) => s.loadCatalog);
  const loadConnections = useIntegrationStore((s) => s.loadConnections);
  const workspaceId = useWorkspaceStore((s) => s.current?.id);
  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);
  useEffect(() => {
    if (workspaceId) loadConnections(workspaceId, { force: true });
  }, [workspaceId, loadConnections]);

  const onConnect = useCallback((connection) => useWorkflowStore.getState().connect(connection), []);
  const onMouseMove = useCursorBroadcast(canvasRef, viewportRef);
  const { others } = usePresence();

  const { errors, warnings, info } = useMemo(
    () => validateGraph({ nodes, edges, integrations, connections, workflows, currentWorkflowId: id }),
    [nodes, edges, integrations, connections, workflows, id],
  );

  // Others' selections show as a ring in their color (spec/28 §4).
  const decoratedNodes = useMemo(() => {
    const ringFor = new Map();
    for (const peer of others) {
      for (const nodeId of peer.selection?.nodeIds || []) if (!ringFor.has(nodeId)) ringFor.set(nodeId, peer.color);
    }
    if (!ringFor.size) return nodes;
    return nodes.map((n) =>
      ringFor.has(n.id) ? { ...n, style: { ...n.style, outline: `3px solid ${ringFor.get(n.id)}`, outlineOffset: 2, borderRadius: 12 } } : n,
    );
  }, [nodes, others]);

  const decoratedEdges = useMemo(
    () => edges.map((e) => {
      if (e.id === selectedEdgeId) return { ...e, style: SELECTED_EDGE_STYLE };
      // spec/31 §7: error branches read as red and dashed in the editor too, not
      // only in the run monitor.
      if (e.sourceHandle === 'error') return { ...e, style: ERROR_EDGE_STYLE };
      return e;
    }),
    [edges, selectedEdgeId],
  );

  function handleAddNode(type) {
    store.addNode(type, { x: 100 + Math.random() * 300, y: 100 + Math.random() * 300 });
  }

  function revealNode(nodeId) {
    if (nodeId) store.focusNode(nodeId);
  }

  function focusPeer(peer) {
    if (!peer?.cursor || !flowRef.current) return;
    flowRef.current.setCenter(peer.cursor.x, peer.cursor.y, { zoom: viewportRef.current.zoom, duration: 400 });
  }

  async function handleRun(source = 'draft') {
    setRunning(true);
    setServerError('');
    try {
      const { runId } = await createRun(id, source);
      navigate(wp(`/runs/${runId}`));
    } catch (err) {
      if (err?.response?.status === 429) {
        setLimitUntil(err.response.data?.resetAt || null);
        setServerError(`Daily run limit reached — resets at ${formatResetAt(err.response.data?.resetAt)}.`);
      } else {
        setServerError(apiErrorMessage(err, 'Failed to start run'));
      }
    } finally {
      setRunning(false);
    }
  }

  if (loading) return <BuilderSkeleton />;
  if (notFound) return <ResourceNotFound kind="workflow" />;

  const syncing = pendingCount > 0;
  const runBlockedReason = limitUntil
    ? `Daily run limit reached — resets at ${formatResetAt(limitUntil)}.`
    : syncing
      ? 'Syncing your latest changes…'
      : errors.length
        ? 'Fix the errors below before running.'
        : warnings.length
          ? 'Resolve the warnings below before running.'
          : undefined;
  const hasSelection = nodes.some((n) => n.selected);

  return (
    <div className="flex h-[calc(100vh-57px)] flex-col">
      {/* One toolbar row across the whole Builder (spec/36): it sits above the
          canvas and side panels, so nothing in it can overlap the config panel. */}
      <div
        data-testid="builder-toolbar"
        className="relative z-20 flex h-12 shrink-0 flex-nowrap items-center gap-2 border-b border-slate-200/80 bg-white/80 px-3 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/80"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {canEdit && <SaveStatus />}
          <VersionChip
            publishedVersion={versionState.publishedVersion}
            hasUnpublishedChanges={versionState.hasUnpublishedChanges}
            onClick={() => setVersionsOpen((o) => !o)}
          />
          {(serverError || lastError) && (
            <span
              title={serverError || lastError}
              className="min-w-0 truncate rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600 dark:bg-red-950 dark:text-red-300"
            >
              {serverError || lastError}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {canRun && (
            <RunSplitButton
              onRun={handleRun}
              running={running}
              // Test runs follow spec/20's blocking rules; "Run published" doesn't.
              testBlocked={syncing || errors.length > 0 || warnings.length > 0}
              testBlockedReason={runBlockedReason}
              quotaBlocked={Boolean(limitUntil)}
              quotaReason={limitUntil ? `Daily run limit reached — resets at ${formatResetAt(limitUntil)}.` : undefined}
              publishedVersion={versionState.publishedVersion}
            />
          )}
          {canPublish && (
            <Button
              onClick={() => setPublishOpen(true)}
              disabled={syncing}
              title={syncing ? 'Syncing your latest changes…' : 'Publish the draft as a new version'}
            >
              Publish
            </Button>
          )}

          {canEdit && (
            <div className="hidden items-center gap-0.5 rounded-lg border border-slate-200 bg-white/60 p-0.5 dark:border-slate-700 dark:bg-slate-900/60 xl:flex">
              <IconAction onClick={store.undo} disabled={!past.length} title="Undo your last change (⌘Z)" label="↺" />
              <IconAction onClick={store.redo} disabled={!future.length} title="Redo (⇧⌘Z)" label="↻" />
              <IconAction onClick={store.duplicateSelection} disabled={!hasSelection} title="Duplicate selection (⌘D)" label="⧉" />
              <IconAction onClick={store.paste} disabled={!clipboard?.nodes?.length} title="Paste (⌘V)" label="⇤" />
            </div>
          )}

          {/* CommentsLayer portals its Comment / Threads / Resolved controls here. */}
          <div ref={setCommentsSlot} className="flex items-center" />
          <WatchToggle workflowId={id} />

          <Menu
            align="right"
            title="More actions"
            testId="builder-more"
            label={<span aria-hidden="true">⋯</span>}
            buttonClassName="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-600 shadow-sm hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {canShare && (
              <MenuButton onClick={() => setShareDialog(true)}>{shareToken ? 'Share · on' : 'Share'}</MenuButton>
            )}
            {canTemplate && (
              <MenuButton onClick={() => setTemplateDialog(true)} disabled={syncing} title={syncing ? 'Syncing your latest changes…' : undefined}>
                Save as template
              </MenuButton>
            )}
            <MenuLink to={wp(`/workflows/${id}/runs`)}>History</MenuLink>
            <MenuButton onClick={() => setVersionsOpen(true)}>Versions</MenuButton>
            {canEdit && (
              // The icon group is hidden below xl; its actions live here instead.
              <div className="xl:hidden">
                <MenuSeparator />
                <MenuButton onClick={store.undo} disabled={!past.length}>Undo</MenuButton>
                <MenuButton onClick={store.redo} disabled={!future.length}>Redo</MenuButton>
                <MenuButton onClick={store.duplicateSelection} disabled={!hasSelection}>Duplicate selection</MenuButton>
                <MenuButton onClick={store.paste} disabled={!clipboard?.nodes?.length}>Paste</MenuButton>
              </div>
            )}
          </Menu>

          <PresenceAvatars onFocusPeer={focusPeer} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
          <NameInput name={name} readOnly={!canEdit} onChange={store.setName} />
          {canEdit ? (
            <NodePalette onAdd={handleAddNode} />
          ) : (
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <span className="font-medium">Read-only.</span> Your role can view this workflow and its runs, but not edit
              or run it. Other people's edits appear live.
            </p>
          )}
          <div className="my-4 border-t border-slate-200 dark:border-slate-800" />
          <TriggerPanel workflowId={id} readOnly={!canTriggers} />
        </div>

        <div ref={canvasRef} className="relative min-w-0 flex-1" onMouseMove={onMouseMove}>
          <ReactFlow
            nodes={decoratedNodes}
            edges={decoratedEdges}
            onNodesChange={store.onNodesChange}
            onEdgesChange={store.onEdgesChange}
            onConnect={canEdit ? onConnect : undefined}
            onNodeDragStart={store.beginGesture}
            onNodeDragStop={store.endGesture}
            nodesDraggable={canEdit}
            nodesConnectable={canEdit}
            // Same handle suppression as the run monitor's read-only view.
            className={canEdit ? undefined : 'rf-readonly'}
            onNodeClick={(_, node) => store.selectNode(node.id)}
            onEdgeClick={(_, edge) => store.selectEdge(edge.id)}
            onPaneClick={() => {
              store.selectNode(null);
              store.selectEdge(null);
            }}
            onInit={(instance) => {
              flowRef.current = instance;
              const vp = instance.getViewport();
              viewportRef.current = vp;
              setViewport(vp);
            }}
            onMove={(_, vp) => {
              viewportRef.current = vp;
              setViewport(vp);
            }}
            nodeTypes={nodeTypes}
            // Deletion goes through the store so it lands in the undo stack.
            deleteKeyCode={null}
            fitView
          >
            <Background />
            {/* Top-left: the bottom-left corner belongs to the validation pill. */}
            <Controls position="top-left" />
            <MiniMap pannable zoomable className="!bg-white dark:!bg-slate-900" />
          </ReactFlow>

          <RemoteCursors viewport={viewport} width={canvasSize.width} height={canvasSize.height} />
          <CommentsLayer
            workflowId={id}
            nodes={nodes}
            viewport={viewport}
            flowRef={flowRef}
            width={canvasSize.width}
            controlsTarget={commentsSlot}
          />

          <ValidationPanel errors={errors} warnings={warnings} info={info} onSelectNode={revealNode} />

          {diffRange && (
            <DiffView
              workflowId={id}
              from={diffRange.from}
              to={diffRange.to}
              onChangeRange={setDiffRange}
              onClose={() => setDiffRange(null)}
            />
          )}
          {versionsOpen && (
            <VersionsDrawer
              workflowId={id}
              // Diff mode takes the whole canvas, so the drawer steps aside.
              onView={(v) => { setVersionsOpen(false); setDiffRange({ from: v, to: v }); }}
              onCompare={(from, to) => { setVersionsOpen(false); setDiffRange({ from, to }); }}
              onChanged={versionState.refresh}
              onClose={() => setVersionsOpen(false)}
            />
          )}
        </div>

        {/* A crashing config panel shows its own error card; the canvas keeps working (spec/36 §6). */}
        {selectedNodeId && (
          <CanvasErrorBoundary resetKey={selectedNodeId}>
            <NodeConfigPanel readOnly={!canEdit} />
          </CanvasErrorBoundary>
        )}
        {selectedEdgeId && (
          <CanvasErrorBoundary resetKey={selectedEdgeId}>
            <EdgeInspector readOnly={!canEdit} />
          </CanvasErrorBoundary>
        )}
      </div>

      {publishOpen && (
        <PublishDialog
          workflowId={id}
          publishedVersion={versionState.publishedVersion}
          errors={errors}
          warnings={warnings}
          onViewDiff={() => setDiffRange({ from: versionState.publishedVersion, to: 'draft' })}
          onPublished={versionState.refresh}
          onClose={() => setPublishOpen(false)}
        />
      )}

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
    </div>
  );
}

function BuilderSkeleton() {
  return (
    <div role="status" aria-label="Loading workflow" className="flex h-[calc(100vh-57px)] flex-col">
      <div className="flex h-12 items-center gap-2 border-b border-slate-200/80 px-3 dark:border-slate-800/80">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-6 w-24 rounded-full" />
        <div className="flex-1" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-20" />
      </div>
      <div className="flex flex-1">
        <div className="w-64 space-y-2 border-r border-slate-200 p-4 dark:border-slate-800">
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
        <div className="flex flex-1 items-center justify-center gap-10">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>
    </div>
  );
}

/**
 * The server trims names (spec/28 rename op), so binding the field straight to
 * the synced name would eat a space the moment it's typed. While focused the
 * field keeps its own text; remote renames show whenever it isn't being edited.
 */
function NameInput({ name, readOnly, onChange }) {
  const [draft, setDraft] = useState(null);
  return (
    <input
      value={draft ?? name}
      readOnly={readOnly}
      onFocus={() => setDraft(name)}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value.trim()) onChange(e.target.value);
      }}
      className="mb-4 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
    />
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
