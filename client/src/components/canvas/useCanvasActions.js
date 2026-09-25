import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkflowStore } from '../../store/workflowStore';
import { useToastStore } from '../../store/toastStore';
import { useCanvasUi } from './canvasUiStore';
import { autoLayout, alignNodes, distributeNodes, edgeMidpoint, DEFAULT_SIZE } from './layout';
import { nodeResultOf } from './useLatestRun';

const S = () => useWorkflowStore.getState();
const toast = (msg, tone = 'info') => {
  try {
    useToastStore.getState().push(msg, tone);
  } catch {
    /* no toast host */
  }
};

/** True if the event came from something the canvas menu should handle. */
function canvasTargetOf(el) {
  return el?.closest?.('.react-flow__node, .react-flow__edge, .react-flow__edgelabel-renderer, .react-flow__pane, .react-flow__nodesselection, .react-flow__selection');
}

/**
 * Everything the canvas's right-click menu, the inspector's ⋯ menu, the
 * keyboard shortcuts and the "add a node" affordances do - in one place, all
 * through the collab store's public actions (so every edit syncs, undoes and
 * is refused for viewers like any other).
 */
export function useCanvasActions({ flowRef, canvasRef, canEdit }) {
  const [target, setTarget] = useState(null);
  const pending = useRef(null);
  const connecting = useRef(null);

  /** Flow coordinates for a point on screen. */
  const toFlow = useCallback((screen) => {
    const box = canvasRef.current?.getBoundingClientRect();
    if (!flowRef.current || !box) return { x: 0, y: 0 };
    return flowRef.current.project({ x: screen.x - box.left, y: screen.y - box.top });
  }, [flowRef, canvasRef]);

  /** Steps a spot down until no node sits there, so a new node never lands on top of one. */
  const clearSpot = useCallback((p) => {
    const nodes = S().nodes;
    const taken = (q) => nodes.some((n) => Math.abs(n.position.x - q.x) < DEFAULT_SIZE.width - 20 && Math.abs(n.position.y - q.y) < DEFAULT_SIZE.height + 10);
    let at = { x: Math.round(p.x), y: Math.round(p.y) };
    for (let i = 0; i < 12 && taken(at); i += 1) at = { x: at.x, y: at.y + DEFAULT_SIZE.height + 30 };
    return at;
  }, []);

  const selectedOthers = (node) => S().nodes.filter((n) => n.selected && n.id !== node.id);

  // --- context-menu targets (React Flow calls these before the menu opens) --
  const onNodeContextMenu = useCallback((event, node) => {
    const full = S().nodes.find((n) => n.id === node.id) || node;
    if (full.selected && selectedOthers(full).length) {
      pending.current = { kind: 'selection', nodes: S().nodes.filter((n) => n.selected) };
    } else {
      S().selectNodes([full.id]);
      pending.current = { kind: 'node', node: full };
    }
  }, []);
  const onSelectionContextMenu = useCallback((event, nodes) => {
    const ids = new Set(nodes.map((n) => n.id));
    pending.current = { kind: 'selection', nodes: S().nodes.filter((n) => ids.has(n.id)) };
  }, []);
  const onEdgeContextMenu = useCallback((event, edge) => {
    pending.current = { kind: 'edge', edge: S().edges.find((e) => e.id === edge.id) || edge, screen: { x: event.clientX, y: event.clientY } };
  }, []);
  const onPaneContextMenu = useCallback((event) => {
    const screen = { x: event.clientX, y: event.clientY };
    pending.current = { kind: 'pane', screen, flow: toFlow(screen) };
  }, [toFlow]);

  /**
   * The canvas wrapper's own onContextMenu (the Radix trigger). Anything that
   * isn't the graph - a comment popover, the validation panel - keeps the
   * browser's menu instead of a stale canvas one.
   */
  const onWrapperContextMenu = useCallback((event) => {
    if (!pending.current && canvasTargetOf(event.target)) {
      const screen = { x: event.clientX, y: event.clientY };
      pending.current = { kind: 'pane', screen, flow: toFlow(screen) };
    }
    if (!pending.current) {
      event.preventDefault();
      return;
    }
    setTarget(pending.current);
    pending.current = null;
  }, [toFlow]);

  // --- actions ------------------------------------------------------------
  const actions = {
    openSettings: (id) => { S().focusNode(id); useCanvasUi.getState().setInspectorTab('settings'); },
    rename: (id) => { useCanvasUi.getState().startRename(id); },
    duplicate: (ids) => S().duplicateNodes(ids),
    copy: (ids) => { S().copyNodes(ids); toast(`Copied ${ids.length === 1 ? 'node' : `${ids.length} nodes`}`); },
    cut: (ids) => S().cutNodes(ids),
    remove: (ids) => S().deleteNodes(ids),
    setDisabled: (ids, disabled) => S().setNodesDisabled(ids, disabled),
    commentOnNode: (id) => {
      const node = S().nodes.find((n) => n.id === id);
      if (!node) return;
      useCanvasUi.getState().requestComment({ type: 'node', nodeId: id }, { x: node.position.x + (node.width || DEFAULT_SIZE.width), y: node.position.y });
    },
    commentHere: (flow) => useCanvasUi.getState().requestComment({ type: 'canvas', x: Math.round(flow.x), y: Math.round(flow.y) }, flow),
    viewOutput: (id) => { S().focusNode(id); useCanvasUi.getState().setInspectorTab('output'); },
    docs: (id) => { S().focusNode(id); useCanvasUi.getState().setInspectorTab('docs'); },
    copyId: async (id) => {
      try {
        await navigator.clipboard.writeText(id);
        toast('Node ID copied');
      } catch {
        toast(`Node ID: ${id}`);
      }
    },
    align: (mode, ids) => {
      const want = new Set(ids);
      S().moveNodes(alignNodes(S().nodes.filter((n) => want.has(n.id)), mode));
    },
    distribute: (axis, ids) => {
      const want = new Set(ids);
      S().moveNodes(distributeNodes(S().nodes.filter((n) => want.has(n.id)), axis));
    },
    autoLayout: (ids) => {
      const want = ids ? new Set(ids) : null;
      const nodes = want ? S().nodes.filter((n) => want.has(n.id)) : S().nodes;
      const edges = S().edges.filter((e) => (!want || (want.has(e.source) && want.has(e.target))));
      const positions = autoLayout(nodes, edges);
      S().moveNodes(positions);
      if (!ids) setTimeout(() => flowRef.current?.fitView({ padding: 0.2, duration: 300, maxZoom: 1, minZoom: 0.7 }), 50);
    },
    insertOnEdge: (edgeId, screen = null) => {
      const edge = S().edges.find((e) => e.id === edgeId);
      if (!edge) return;
      const flow = edgeMidpoint(edge, new Map(S().nodes.map((n) => [n.id, n])));
      const box = canvasRef.current?.getBoundingClientRect();
      const vp = flowRef.current?.getViewport?.() || { x: 0, y: 0, zoom: 1 };
      const at = screen || { x: (box?.left || 0) + (flow.x + DEFAULT_SIZE.width / 2) * vp.zoom + vp.x, y: (box?.top || 0) + flow.y * vp.zoom + vp.y };
      useCanvasUi.getState().requestAdd({ kind: 'edge', edgeId, screen: at, flow });
    },
    editEdgeLabel: (id) => S().selectEdge(id),
    deleteEdge: (id) => S().deleteEdge(id),
    addHere: ({ screen, flow }) => useCanvasUi.getState().requestAdd({ kind: 'here', screen, flow }),
    pasteHere: (flow) => S().pasteAt({ x: Math.round(flow.x), y: Math.round(flow.y) }),
    selectAll: () => S().selectAll(),
    fitView: () => flowRef.current?.fitView({ padding: 0.15, duration: 300, maxZoom: 1, minZoom: 0.4 }),
    /**
     * The first view of a workflow: fitted only between 90% and 100% so text
     * stays legible; a graph too big for that starts from the left (Start) and
     * is panned rather than shrunk.
     */
    readableFit: () => {
      const flow = flowRef.current;
      const box = canvasRef.current?.getBoundingClientRect();
      const nodes = S().nodes;
      if (!flow || !box || !nodes.length) return;
      const pad = 56;
      const minX = Math.min(...nodes.map((n) => n.position.x));
      const minY = Math.min(...nodes.map((n) => n.position.y));
      const maxX = Math.max(...nodes.map((n) => n.position.x + (n.width || DEFAULT_SIZE.width)));
      const maxY = Math.max(...nodes.map((n) => n.position.y + (n.height || DEFAULT_SIZE.height)));
      const w = Math.max(1, maxX - minX);
      const h = Math.max(1, maxY - minY);
      const fit = Math.min((box.width - 2 * pad) / w, (box.height - 2 * pad) / h);
      const zoom = Math.max(0.9, Math.min(1, fit));
      const fitsX = w * zoom <= box.width - 2 * pad;
      const fitsY = h * zoom <= box.height - 2 * pad;
      const start = nodes.find((n) => n.type === 'start');
      const x = fitsX ? (box.width - w * zoom) / 2 - minX * zoom : pad - minX * zoom;
      const y = fitsY
        ? (box.height - h * zoom) / 2 - minY * zoom
        : box.height / 2 - ((start ? start.position.y + (start.height || DEFAULT_SIZE.height) / 2 : minY + h / 2) * zoom);
      flow.setViewport({ x, y, zoom });
    },
    zoom100: () => flowRef.current?.zoomTo(1, { duration: 200 }),
    undo: () => S().undo(),
    redo: () => S().redo(),
  };

  /** A pick from the AddNodeMenu, routed by what asked for it. */
  const pickAdd = useCallback((type) => {
    const req = useCanvasUi.getState().addRequest;
    useCanvasUi.getState().clearAddRequest();
    if (!req) return;
    const flow = req.flow || toFlow(req.screen);
    if (req.kind === 'edge') {
      S().insertNodeOnEdge(req.edgeId, type, clearSpot(flow));
      return;
    }
    if (req.kind === 'connect') {
      const from = S().nodes.find((n) => n.id === req.from?.nodeId);
      // After a source handle: to the right of the node; before a target handle: to its left.
      const base = req.flow
        ? { x: flow.x, y: flow.y - DEFAULT_SIZE.height / 2 }
        : from
          ? { x: from.position.x + (req.from.handleType === 'target' ? -(DEFAULT_SIZE.width + 100) : (from.width || DEFAULT_SIZE.width) + 100), y: from.position.y }
          : flow;
      S().addNodeConnected(type, clearSpot(base), req.from);
      return;
    }
    S().addNodeConnected(type, clearSpot({ x: flow.x - DEFAULT_SIZE.width / 2, y: flow.y - DEFAULT_SIZE.height / 2 }), null);
  }, [toFlow, clearSpot]);

  // --- connect-to-add and double-click-to-add --------------------------------
  const onConnectStart = useCallback((_, params) => { connecting.current = params; }, []);
  const onConnectEnd = useCallback((event) => {
    const from = connecting.current;
    connecting.current = null;
    if (!from || !canEdit) return;
    const point = 'changedTouches' in event ? event.changedTouches[0] : event;
    // Dropped on empty canvas - not on a node or a handle (a real connection,
    // or one React Flow refused) and still inside the canvas: offer the add menu.
    // Hit-tested rather than read off event.target, which during a connection
    // drag is whatever layer React Flow drew on top.
    const el = document.elementFromPoint(point.clientX, point.clientY);
    if (!el || el.closest('.react-flow__node, .react-flow__handle') || !el.closest('.react-flow')) return;
    const screen = { x: point.clientX, y: point.clientY };
    useCanvasUi.getState().requestAdd({ kind: 'connect', screen, flow: toFlow(screen), from });
  }, [toFlow, canEdit]);

  const onWrapperDoubleClick = useCallback((event) => {
    if (!canEdit) return;
    // Only empty canvas: not a node, edge, handle or any of the canvas chrome.
    const el = document.elementFromPoint(event.clientX, event.clientY);
    if (!el?.closest('.react-flow') || el.closest('.react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__panel, .react-flow__controls, .react-flow__minimap, .react-flow__edgelabel-renderer, button, input, textarea')) return;
    const screen = { x: event.clientX, y: event.clientY };
    useCanvasUi.getState().requestAdd({ kind: 'here', screen, flow: toFlow(screen) });
  }, [toFlow, canEdit]);

  // --- keyboard parity for the menu items -----------------------------------
  useEffect(() => {
    const typing = (el) => el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.getAttribute?.('role') === 'combobox');
    function onKey(e) {
      if (typing(e.target) || document.querySelector('[role=menu], [role=dialog]')) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const selected = S().nodes.filter((n) => n.selected).map((n) => n.id);
      if (e.shiftKey && !mod && (e.key === ')' || e.code === 'Digit0')) { e.preventDefault(); actions.zoom100(); return; }
      if (e.shiftKey && !mod && e.code === 'Digit1') { e.preventDefault(); actions.fitView(); return; }
      if (!canEdit) {
        if (mod && key === 'a') { e.preventDefault(); actions.selectAll(); }
        return;
      }
      if (mod && key === 'a') { e.preventDefault(); actions.selectAll(); return; }
      if (mod && key === 'x' && selected.length) { e.preventDefault(); actions.cut(selected); return; }
      if (e.key === 'F2' && selected.length === 1) { e.preventDefault(); actions.rename(selected[0]); return; }
      if (e.key === 'Enter' && selected.length === 1 && !['BUTTON', 'A'].includes(e.target?.tagName)) { e.preventDefault(); actions.openSettings(selected[0]); return; }
      if (e.shiftKey && !mod && key === 'd' && selected.length) {
        e.preventDefault();
        const nodes = S().nodes.filter((n) => selected.includes(n.id) && n.type !== 'start' && n.type !== 'end');
        const allDisabled = nodes.length && nodes.every((n) => n.data?.config?.disabled);
        actions.setDisabled(nodes.map((n) => n.id), !allDisabled);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // re-bound each render: `actions` closes over the latest refs

  const latestRun = useCanvasUi((s) => s.latestRun);
  const menuState = {
    hasRunResult: (id) => {
      const r = nodeResultOf(latestRun, id);
      return Boolean(r && r.status !== 'pending');
    },
    canPaste: Boolean(useWorkflowStore.getState().clipboard?.nodes?.length),
    hasNodes: useWorkflowStore.getState().nodes.length > 0,
    canUndo: useWorkflowStore.getState().past.length > 0,
    canRedo: useWorkflowStore.getState().future.length > 0,
  };

  return {
    target, actions, menuState, pickAdd,
    onNodeContextMenu, onSelectionContextMenu, onEdgeContextMenu, onPaneContextMenu, onWrapperContextMenu,
    onConnectStart, onConnectEnd, onWrapperDoubleClick,
  };
}
