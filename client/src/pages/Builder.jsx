import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Undo2, Redo2, CopyPlus, ClipboardPaste, MoreHorizontal, Share2, LayoutTemplate, History, GitCommitVertical, Rocket, X, Zap } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactFlow, { Background, BackgroundVariant, Controls, MiniMap } from 'reactflow';
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
import CanvasRail from '../components/builder/CanvasRail';
import { NODE_DRAG_TYPE } from '../components/nodeCatalog';
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
import { ContextMenu, ContextMenuTrigger } from '../components/ui/ContextMenu';
import CanvasContextMenu from '../components/canvas/CanvasContextMenu';
import CanvasChrome from '../components/canvas/CanvasChrome';
import { useCanvasActions } from '../components/canvas/useCanvasActions';
import { useCanvasUi } from '../components/canvas/canvasUiStore';
import { useBreadcrumb } from '../store/breadcrumbStore';
import { useLatestRun } from '../components/canvas/useLatestRun';

const ERROR_EDGE_STYLE = { stroke: '#ef4444', strokeWidth: 1.5, strokeDasharray: '6 4' };
const SELECTED_EDGE_STYLE = { stroke: '#6366f1', strokeWidth: 2.5 };
// Edge labels as small pills (colours come from the React Flow theme in index.css).
const EDGE_LABEL = {
  labelStyle: { fontSize: 12, fontWeight: 600 },
  labelBgStyle: { stroke: 'rgb(var(--border-strong))', strokeWidth: 1 },
  labelBgPadding: [8, 4],
  labelBgBorderRadius: 6,
};
const PROBLEM_RANK = { error: 3, warning: 2, info: 1 };

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
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const canvas = useCanvasActions({ flowRef, canvasRef, canEdit: useCan('workflow:edit') });
  const snapToGrid = useCanvasUi((s) => s.snapToGrid);
  const minimapPref = useCanvasUi((s) => s.minimapPref);
  const runOverlay = useCanvasUi((s) => s.showRunOverlay);
  const latestRun = useCanvasUi((s) => s.latestRun);
  useLatestRun(id);
  // Automatic until toggled: only graphs big enough to get lost in get a minimap.
  const showMinimap = minimapPref ?? store.nodes.length > 8;
  // Open at a readable zoom (spec: nodes legible at the default view). React
  // Flow's fitView would shrink a wide graph until its text is ~9px; instead
  // fit only between 90% and 100%, and if it's still too big, start from the
  // left where runs begin and let the user pan. Once per workflow, after the
  // nodes have been measured.
  const fittedFor = useRef(null);
  useEffect(() => {
    if (loading || fittedFor.current === id || !flowRef.current || !store.nodes.length) return;
    if (!store.nodes.every((n) => n.width)) return;
    fittedFor.current = id;
    canvas.actions.readableFit();
  });
  // Open by default so a workflow's triggers are readable at a glance; closing it
  // is remembered per browser.
  // Closed on load so the canvas gets the room; opened from the rail's ⚡ or ⋯ → Triggers.
  const [triggersOpen, setTriggersOpen] = useState(false);
  const userId = useAuthStore((s) => s.user?.id);
  // Viewers get the canvas read-only (spec/23). The server enforces every one
  // of these regardless; this just doesn't offer what would be refused.
  const canEdit = useCan('workflow:edit');
  const canRun = useCan('workflow:run');
  const canShare = useCan('share:manage');
  const canTemplate = useCan('templates:create');
  const canTriggers = useCan('triggers:manage');
  const canPublish = useCan('workflow:publish');
  const canCommentCanvas = useCan('comments:write');
  // spec/30: draft vs published.
  const versionState = useVersionState(id);
  const [publishOpen, setPublishOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [diffRange, setDiffRange] = useState(null); // { from, to } or null
  const [commentsSlot, setCommentsSlot] = useState(null);

  const workspaceName = useWorkspaceStore((s) => s.current?.name);
  useDocumentTitle(name ? `${name}${workspaceName ? ` · ${workspaceName}` : ''}` : null);
  useBreadcrumb(name);
  useCanvasShortcuts({ enabled: canEdit });
  useEffect(() => {
    if (!canEdit) return undefined;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') { e.preventDefault(); setAddMenuOpen((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit]);
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
  // Per-node problems for the nodes' validation dots and the inspector.
  useEffect(() => {
    const byNode = {};
    const add = (list, level) => {
      for (const p of list) {
        if (!p.nodeId) continue;
        const entry = (byNode[p.nodeId] ||= { level: null, messages: [], items: [] });
        entry.items.push({ ...p, level });
        // Info never gets a dot; it's listed in the inspector only.
        if (level !== 'info') {
          entry.messages.push(p.message);
          if (!entry.level || PROBLEM_RANK[level] > PROBLEM_RANK[entry.level]) entry.level = level;
        }
      }
    };
    add(errors, 'error');
    add(warnings, 'warning');
    add(info, 'info');
    const dots = Object.fromEntries(Object.entries(byNode).map(([k, v]) => [k, v.level ? v : { ...v, level: null }]));
    useCanvasUi.getState().setProblems(dots);
  }, [errors, warnings, info]);

  // Others' selections show as a ring in their color (spec/28 §4).
  const decoratedNodes = useMemo(() => {
    const ringFor = new Map();
    for (const peer of others) {
      for (const nodeId of peer.selection?.nodeIds || []) if (!ringFor.has(nodeId)) ringFor.set(nodeId, peer.color);
    }
    // The latest run drawn over the canvas (the "last run" toggle).
    const results = runOverlay && latestRun ? new Map((latestRun.nodeResults || []).map((r) => [r.nodeId, r])) : null;
    if (!ringFor.size && !results) return nodes;
    return nodes.map((n) => {
      let out = n;
      const r = results?.get(n.id);
      if (r && r.status !== 'pending') {
        out = { ...out, data: { ...out.data, runStatus: r.status, skipReason: r.skipReason, durationMs: r.durationMs, cached: r.cached, runMode: r.mode, waiting: r.waiting } };
      }
      if (ringFor.has(n.id)) out = { ...out, style: { ...out.style, outline: `3px solid ${ringFor.get(n.id)}`, outlineOffset: 2, borderRadius: 12 } };
      return out;
    });
  }, [nodes, others, runOverlay, latestRun]);

  const decoratedEdges = useMemo(
    () => {
      const running = runOverlay && latestRun?.status === 'running'
        ? new Set((latestRun.nodeResults || []).filter((r) => r.status === 'running').map((r) => r.nodeId))
        : null;
      return edges.map((e) => {
        const base = { ...e, type: 'smoothstep', ...EDGE_LABEL, ...(running?.has(e.target) && { animated: true }) };
        if (e.id === selectedEdgeId) return { ...base, style: SELECTED_EDGE_STYLE };
        // spec/31 §7: error branches read as red and dashed in the editor too, not
        // only in the run monitor.
        if (e.sourceHandle === 'error') return { ...base, style: ERROR_EDGE_STYLE };
        return base;
      });
    },
    [edges, selectedEdgeId, runOverlay, latestRun],
  );

  // New nodes land in the middle of what you're looking at (nudged so a burst
  // of adds doesn't stack exactly), or where they were dropped.
  function handleAddNode(type, position = null) {
    const flow = flowRef.current;
    const box = canvasRef.current?.getBoundingClientRect();
    let at = position;
    if (!at && flow && box) {
      const center = flow.project({ x: box.width / 2, y: box.height / 2 });
      at = { x: center.x - 116, y: center.y - 30 };
      // Step down until the spot is clear, so a new node never lands on top of
      // an existing one (and can't be grabbed by mistake).
      const taken = (p) => nodes.some((n) => Math.abs(n.position.x - p.x) < 200 && Math.abs(n.position.y - p.y) < 70);
      for (let i = 0; i < 12 && taken(at); i += 1) at = { x: at.x, y: at.y + 90 };
    }
    store.addNode(type, at || { x: 100 + Math.random() * 300, y: 100 + Math.random() * 300 });
  }

  function onCanvasDragOver(e) {
    if (!canEdit || !e.dataTransfer.types.includes(NODE_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function onCanvasDrop(e) {
    const type = e.dataTransfer.getData(NODE_DRAG_TYPE);
    if (!type || !canEdit || !flowRef.current || !canvasRef.current) return;
    e.preventDefault();
    const box = canvasRef.current.getBoundingClientRect();
    const p = flowRef.current.project({ x: e.clientX - box.left, y: e.clientY - box.top });
    handleAddNode(type, { x: p.x - 116, y: p.y - 24 });
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
    <div className="flex h-[calc(100vh-var(--topbar-h))] flex-col">
      {/* One toolbar row across the whole Builder (spec/36): it sits above the
          canvas and side panels, so nothing in it can overlap the config panel. */}
      <div
        data-testid="builder-toolbar"
        className="relative z-20 flex h-12 shrink-0 flex-nowrap items-center gap-2 border-b border-default bg-surface px-3"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <NameInput name={name} readOnly={!canEdit} onChange={store.setName} />
          {canEdit && <SaveStatus />}
          <VersionChip
            publishedVersion={versionState.publishedVersion}
            hasUnpublishedChanges={versionState.hasUnpublishedChanges}
            onClick={() => setVersionsOpen((o) => !o)}
          />
          {(serverError || lastError) && (
            <span
              title={serverError || lastError}
              className="min-w-0 truncate rounded-control bg-danger-subtle px-2.5 py-1 text-xs font-medium text-danger-subtle-fg"
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
              <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
              Publish
            </Button>
          )}

          {canEdit && (
            <div className="hidden items-center rounded-control border border-default bg-surface p-0.5 shadow-sm xl:flex">
              <IconAction onClick={store.undo} disabled={!past.length} title="Undo your last change (⌘Z)" icon={Undo2} />
              <IconAction onClick={store.redo} disabled={!future.length} title="Redo (⇧⌘Z)" icon={Redo2} />
              <IconAction onClick={store.duplicateSelection} disabled={!hasSelection} title="Duplicate selection (⌘D)" icon={CopyPlus} />
              <IconAction onClick={store.paste} disabled={!clipboard?.nodes?.length} title="Paste (⌘V)" icon={ClipboardPaste} />
            </div>
          )}

          {/* CommentsLayer portals its Comment / Threads / Resolved controls here. */}
          <div ref={setCommentsSlot} className="flex items-center" />
          <WatchToggle workflowId={id} />

          <Menu
            align="right"
            title="More actions"
            testId="builder-more"
            label={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
            buttonClassName="inline-flex h-8 w-8 items-center justify-center rounded-control border border-default bg-surface text-muted shadow-sm hover:bg-bg-subtle hover:text-fg"
          >
            {canShare && (
              <MenuButton onClick={() => setShareDialog(true)}><Share2 /> {shareToken ? 'Share · on' : 'Share'}</MenuButton>
            )}
            {canTemplate && (
              <MenuButton onClick={() => setTemplateDialog(true)} disabled={syncing} title={syncing ? 'Syncing your latest changes…' : undefined}>
                <LayoutTemplate /> Save as template
              </MenuButton>
            )}
            <MenuLink to={wp(`/workflows/${id}/runs`)}><History /> History</MenuLink>
            <MenuButton onClick={() => setVersionsOpen(true)}><GitCommitVertical /> Versions</MenuButton>
            <MenuButton onClick={() => setTriggersOpen((v) => !v)}><Zap /> {triggersOpen ? 'Hide triggers' : 'Triggers'}</MenuButton>
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
        <CanvasRail
          canEdit={canEdit}
          menuOpen={addMenuOpen}
          onMenuOpenChange={setAddMenuOpen}
          onAdd={(type) => handleAddNode(type)}
          triggersOpen={triggersOpen}
          onToggleTriggers={() => setTriggersOpen((v) => !v)}
        />
        {triggersOpen && (
          <div data-testid="triggers-flyout" className="z-10 flex w-[300px] shrink-0 flex-col border-r border-default bg-surface">
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-default px-3">
              <span className="text-sm font-semibold text-fg">Triggers</span>
              <button type="button" onClick={() => setTriggersOpen(false)} aria-label="Close triggers" className="rounded-control p-1 text-subtle hover:bg-bg-subtle hover:text-fg">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {!canEdit && (
                <p className="mb-3 rounded-control border border-default bg-bg-subtle px-3 py-2 text-xs text-muted">
                  <span className="font-medium">Read-only.</span> Your role can view this workflow and its runs, but not edit
                  or run it. Other people's edits appear live.
                </p>
              )}
              <TriggerPanel workflowId={id} readOnly={!canTriggers} />
            </div>
          </div>
        )}

        <ContextMenu modal={false}>
        <ContextMenuTrigger asChild>
        <div
          ref={canvasRef}
          data-testid="builder-canvas"
          className="relative min-w-0 flex-1"
          onMouseMove={onMouseMove}
          onDragOver={onCanvasDragOver}
          onDrop={onCanvasDrop}
          onContextMenu={canvas.onWrapperContextMenu}
          onDoubleClick={canvas.onWrapperDoubleClick}
        >
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
            // Right-click menus (components/canvas/CanvasContextMenu).
            onNodeContextMenu={canvas.onNodeContextMenu}
            onEdgeContextMenu={canvas.onEdgeContextMenu}
            onPaneContextMenu={canvas.onPaneContextMenu}
            onSelectionContextMenu={canvas.onSelectionContextMenu}
            // Drop a connection on empty canvas → pick the node to create there.
            onConnectStart={canEdit ? canvas.onConnectStart : undefined}
            onConnectEnd={canEdit ? canvas.onConnectEnd : undefined}
            onNodeDoubleClick={(_, node) => canvas.actions.openSettings(node.id)}
            zoomOnDoubleClick={false}
            snapToGrid={snapToGrid}
            snapGrid={[20, 20]}
            selectionKeyCode="Shift"
            multiSelectionKeyCode={['Meta', 'Control']}
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
            // The first view is set by readableFit (above); this is for the
            // explicit "fit" button and ⇧1, which really fit everything.
            fitViewOptions={{ padding: 0.15, minZoom: 0.4, maxZoom: 1 }}
            minZoom={0.25}
            maxZoom={2}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
            {/* Top-left: the bottom-left corner belongs to the validation pill. */}
            <Controls position="top-left" showInteractive={canEdit} />
            {/* Bottom-right, above the view toggles (CanvasChrome); off for small graphs. */}
            {showMinimap && (
              <MiniMap pannable zoomable position="bottom-right" style={{ bottom: 44, width: 180, height: 120 }} />
            )}
          </ReactFlow>

          <CanvasChrome
            canEdit={canEdit}
            empty={!nodes.length}
            onPick={canvas.pickAdd}
            onAddStart={() => handleAddNode('start')}
            showMinimap={showMinimap}
          />

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
        </ContextMenuTrigger>
        <CanvasContextMenu
          target={canvas.target}
          actions={canvas.actions}
          perms={{ canEdit, canComment: canCommentCanvas }}
          state={canvas.menuState}
        />
        </ContextMenu>

        {/* A crashing config panel shows its own error card; the canvas keeps working (spec/36 §6). */}
        {selectedNodeId && (
          <CanvasErrorBoundary resetKey={selectedNodeId}>
            <NodeConfigPanel readOnly={!canEdit} actions={canvas.actions} />
          </CanvasErrorBoundary>
        )}
        {selectedEdgeId && (
          <CanvasErrorBoundary resetKey={selectedEdgeId}>
            <EdgeInspector readOnly={!canEdit} onInsert={(edgeId) => canvas.actions.insertOnEdge(edgeId)} />
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
    <div role="status" aria-label="Loading workflow" className="flex h-[calc(100vh-var(--topbar-h))] flex-col">
      <div className="flex h-12 items-center gap-2 border-b border-default px-3">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-6 w-24 rounded-full" />
        <div className="flex-1" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-20" />
      </div>
      <div className="flex flex-1">
        <div className="w-64 space-y-2 border-r border-default p-4">
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
      data-testid="workflow-name"
      aria-label="Workflow name"
      className="h-8 w-56 min-w-0 shrink rounded-control border border-transparent bg-transparent px-2 text-sm font-semibold text-fg hover:border-default focus:border-accent focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20"
    />
  );
}

function IconAction({ onClick, disabled, title, icon: Icon }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="inline-flex h-7 w-7 items-center justify-center rounded-[5px] text-muted transition-colors hover:bg-bg-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
