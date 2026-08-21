import { create } from 'zustand';
import { applyNodeChanges, applyEdgeChanges } from 'reactflow';

let idCounter = 0;
const nextId = (prefix) => `${prefix}-${Date.now()}-${idCounter++}`;

const HISTORY_LIMIT = 50;
/** Edits to the same field inside this window collapse into one history entry. */
const COALESCE_MS = 500;
const PASTE_OFFSET = 40;

const deepCopy = (value) =>
  typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));

const DEFAULT_CONFIGS = {
  start: { label: 'Start' },
  end: { label: 'End' },
  agent: { label: 'New Agent', systemPrompt: '', isHandoff: false, candidates: [] },
  tool: { label: 'New Tool', toolType: '' },
  condition: { label: 'Condition', expression: 'true' },
};

/** Condition branches are matched by handle, so their labels aren't free text. */
export const isConditionEdge = (edge) => edge?.sourceHandle === 'true' || edge?.sourceHandle === 'false';

function normalizeNode(n) {
  const config = n.data?.config || { label: n.data?.label || n.type };
  return { ...n, data: { ...n.data, config } };
}

function wouldCreateCycle(nodes, edges, source, target) {
  const adjacency = new Map(nodes.map((n) => [n.id, []]));
  edges.forEach((e) => adjacency.get(e.source)?.push(e.target));
  adjacency.get(source)?.push(target);

  const visited = new Set();
  function dfs(id) {
    if (id === source) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return (adjacency.get(id) || []).some(dfs);
  }
  return (adjacency.get(target) || []).some(dfs);
}

const snapshot = (s) => ({
  nodes: s.nodes,
  edges: s.edges,
  name: s.name,
  selectedNodeId: s.selectedNodeId,
  selectedEdgeId: s.selectedEdgeId,
});

/**
 * Wraps a mutation so it becomes one undoable step. `coalesceKey` merges repeated
 * edits to the same field (typing in a text box) into a single entry instead of
 * one per keystroke.
 */
function withHistory(state, changes, coalesceKey = null) {
  const now = Date.now();
  const continuing = coalesceKey && state.coalesceKey === coalesceKey && now - state.coalesceAt < COALESCE_MS;
  return {
    ...changes,
    past: continuing ? state.past : [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
    future: [],
    dirty: true,
    coalesceKey: coalesceKey || null,
    coalesceAt: coalesceKey ? now : 0,
  };
}

/** Clones nodes (and the edges *between* them) with fresh ids and deep-copied config. */
function cloneGraph(sourceNodes, sourceEdges, { offset, hasStart }) {
  const idMap = new Map();
  const nodes = [];
  let droppedStart = false;

  for (const n of sourceNodes) {
    if (n.type === 'start' && hasStart) {
      droppedStart = true;
      continue;
    }
    const id = nextId(n.type);
    idMap.set(n.id, id);
    nodes.push({
      id,
      type: n.type,
      position: { x: (n.position?.x || 0) + offset, y: (n.position?.y || 0) + offset },
      // Deep copy: a shallow one would alias arrays like `candidates`, so editing
      // the clone would silently edit the original.
      data: { config: deepCopy(n.data?.config || DEFAULT_CONFIGS[n.type] || {}) },
      selected: true,
    });
  }

  // Only edges wholly inside the selection survive; ones leaving it are dropped.
  const edges = sourceEdges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({
      ...e,
      id: nextId('edge'),
      source: idMap.get(e.source),
      target: idMap.get(e.target),
      selected: false,
    }));

  return { nodes, edges, droppedStart };
}

/** A selection-or-dimension-only change isn't an edit, so it mustn't mark the graph dirty. */
const isEditingChange = (changes) =>
  changes.some((c) => c.type !== 'select' && c.type !== 'dimensions');

export const useWorkflowStore = create((set, get) => ({
  workflowId: null,
  name: 'Untitled workflow',
  nodes: [],
  edges: [],
  selectedNodeId: null,
  selectedEdgeId: null,
  dirty: false,
  lastError: null,
  // Triggers are saved through their own endpoints the moment they change, so
  // they're deliberately outside the graph's dirty/undo state.
  triggers: { schedule: null, webhook: null, eventTrigger: null },
  shareToken: null,

  past: [],
  future: [],
  clipboard: null,
  coalesceKey: null,
  coalesceAt: 0,
  pendingGesture: null,

  loadWorkflow: (wf) =>
    set({
      workflowId: wf._id,
      name: wf.name,
      nodes: (wf.nodes || []).map(normalizeNode),
      edges: wf.edges || [],
      triggers: {
        schedule: wf.schedule || null,
        webhook: wf.webhook || null,
        eventTrigger: wf.eventTrigger || null,
      },
      shareToken: wf.shareToken || null,
      selectedNodeId: null,
      selectedEdgeId: null,
      dirty: false,
      lastError: null,
      // History is per editing session. An empty `past` is what makes undo stop
      // at the load point rather than emptying a canvas the user never emptied.
      past: [],
      future: [],
      clipboard: null,
      pendingGesture: null,
      // Reset the coalesce window too: otherwise the first edit after opening a
      // workflow can be folded into the *previous* workflow's window and end up
      // with no undo entry of its own.
      coalesceKey: null,
      coalesceAt: 0,
    }),

  setName: (name) => set((state) => withHistory(state, { name }, 'name')),

  onNodesChange: (changes) =>
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes),
      dirty: state.dirty || isEditingChange(changes),
    })),

  onEdgesChange: (changes) =>
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
      dirty: state.dirty || isEditingChange(changes),
    })),

  // --- drag gestures -------------------------------------------------------
  // React Flow fires onNodesChange per mouse-move, so snapshotting there would
  // fill the entire stack from one drag. Instead: stash the pre-drag state, and
  // commit it once at the end - and only if something actually moved.
  beginGesture: () => set((state) => ({ pendingGesture: snapshot(state) })),

  endGesture: () =>
    set((state) => {
      const pending = state.pendingGesture;
      if (!pending) return {};
      const moved = pending.nodes.some((n) => {
        const current = state.nodes.find((c) => c.id === n.id);
        return current && (current.position.x !== n.position.x || current.position.y !== n.position.y);
      });
      if (!moved) return { pendingGesture: null };
      return {
        past: [...state.past, pending].slice(-HISTORY_LIMIT),
        future: [],
        dirty: true,
        coalesceKey: null,
        pendingGesture: null,
      };
    }),

  // --- history -------------------------------------------------------------
  undo: () =>
    set((state) => {
      if (!state.past.length) return {};
      const previous = state.past[state.past.length - 1];
      return {
        ...previous,
        past: state.past.slice(0, -1),
        future: [snapshot(state), ...state.future].slice(0, HISTORY_LIMIT),
        // Undo is not a rollback of a save - the reverted state is simply unsaved.
        dirty: true,
        coalesceKey: null,
      };
    }),

  redo: () =>
    set((state) => {
      if (!state.future.length) return {};
      const [next, ...rest] = state.future;
      return {
        ...next,
        past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
        future: rest,
        dirty: true,
        coalesceKey: null,
      };
    }),

  // --- graph edits ---------------------------------------------------------
  addNode: (type, position) => {
    const { nodes } = get();
    if (type === 'start' && nodes.some((n) => n.type === 'start')) {
      set({ lastError: 'A workflow can only have one Start node.' });
      return;
    }
    const node = {
      id: nextId(type),
      type,
      position,
      data: { config: deepCopy(DEFAULT_CONFIGS[type]) },
    };
    set((state) => withHistory(state, { nodes: [...state.nodes, node] }));
  },

  connect: (connection) => {
    const { nodes, edges } = get();
    if (connection.source === connection.target) return;
    if (wouldCreateCycle(nodes, edges, connection.source, connection.target)) {
      set({ lastError: 'That connection would create a cycle, which is not allowed.' });
      return;
    }
    const edge = {
      id: nextId('edge'),
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle || undefined,
      label: connection.sourceHandle === 'true' ? 'true' : connection.sourceHandle === 'false' ? 'false' : undefined,
    };
    set((state) => withHistory(state, { edges: [...state.edges, edge] }));
  },

  deleteSelection: () =>
    set((state) => {
      const nodeIds = new Set(state.nodes.filter((n) => n.selected).map((n) => n.id));
      const edgeIds = new Set(state.edges.filter((e) => e.selected).map((e) => e.id));
      if (!nodeIds.size && !edgeIds.size) return {};
      return withHistory(state, {
        nodes: state.nodes.filter((n) => !nodeIds.has(n.id)),
        edges: state.edges.filter(
          (e) => !edgeIds.has(e.id) && !nodeIds.has(e.source) && !nodeIds.has(e.target),
        ),
        selectedNodeId: nodeIds.has(state.selectedNodeId) ? null : state.selectedNodeId,
        selectedEdgeId: edgeIds.has(state.selectedEdgeId) ? null : state.selectedEdgeId,
      });
    }),

  copySelection: () => {
    const { nodes, edges } = get();
    const selected = nodes.filter((n) => n.selected);
    if (!selected.length) return;
    const ids = new Set(selected.map((n) => n.id));
    set({
      clipboard: {
        nodes: selected.map((n) => ({ id: n.id, type: n.type, position: n.position, data: { config: deepCopy(n.data.config) } })),
        edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
      },
    });
  },

  paste: () => {
    const state = get();
    if (!state.clipboard?.nodes?.length) return;
    get()._insert(state.clipboard.nodes, state.clipboard.edges);
  },

  duplicateSelection: () => {
    const state = get();
    const selected = state.nodes.filter((n) => n.selected);
    if (!selected.length) return;
    const ids = new Set(selected.map((n) => n.id));
    get()._insert(selected, state.edges.filter((e) => ids.has(e.source) && ids.has(e.target)));
  },

  _insert: (sourceNodes, sourceEdges) =>
    set((state) => {
      const { nodes, edges, droppedStart } = cloneGraph(sourceNodes, sourceEdges, {
        offset: PASTE_OFFSET,
        hasStart: state.nodes.some((n) => n.type === 'start'),
      });
      if (!nodes.length) {
        return { lastError: droppedStart ? 'A workflow can only have one Start node.' : null };
      }
      return withHistory(state, {
        nodes: [...state.nodes.map((n) => ({ ...n, selected: false })), ...nodes],
        edges: [...state.edges, ...edges],
        lastError: droppedStart ? 'Skipped the Start node - a workflow can only have one.' : null,
      });
    }),

  // Only one inspector at a time: picking a node closes the edge panel and vice
  // versa. Deselecting clears just its own key.
  selectNode: (id) => set(id ? { selectedNodeId: id, selectedEdgeId: null } : { selectedNodeId: null }),

  selectEdge: (id) => set(id ? { selectedEdgeId: id, selectedNodeId: null } : { selectedEdgeId: null }),

  /** Opens a node's inspector *and* highlights it on the canvas. */
  focusNode: (id) =>
    set((state) => ({
      selectedNodeId: id,
      selectedEdgeId: null,
      nodes: state.nodes.map((n) => ({ ...n, selected: n.id === id })),
      edges: state.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
    })),

  updateNodeConfig: (id, patch) =>
    set((state) =>
      withHistory(
        state,
        {
          nodes: state.nodes.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, config: { ...n.data.config, ...patch } } } : n,
          ),
        },
        `config:${id}:${Object.keys(patch).join(',')}`,
      ),
    ),

  // --- handoff candidates (spec/16) ----------------------------------------
  // Renaming a candidate *does* rewrite matching outgoing edge labels: it's the
  // same branch being renamed, so letting them drift would just manufacture a
  // validation warning. Adding or removing a candidate deliberately does NOT
  // touch edges - that drift is real, and the validation panel should say so
  // rather than have config edits silently rewire the graph.
  addHandoffCandidate: (nodeId) =>
    set((state) =>
      withHistory(state, {
        nodes: state.nodes.map((n) => {
          if (n.id !== nodeId) return n;
          const candidates = n.data.config.candidates || [];
          return {
            ...n,
            data: { ...n.data, config: { ...n.data.config, candidates: [...candidates, `candidate-${candidates.length + 1}`] } },
          };
        }),
      }),
    ),

  removeHandoffCandidate: (nodeId, index) =>
    set((state) =>
      withHistory(state, {
        nodes: state.nodes.map((n) => {
          if (n.id !== nodeId) return n;
          const candidates = (n.data.config.candidates || []).filter((_, i) => i !== index);
          return { ...n, data: { ...n.data, config: { ...n.data.config, candidates } } };
        }),
      }),
    ),

  renameHandoffCandidate: (nodeId, index, name) =>
    set((state) => {
      const node = state.nodes.find((n) => n.id === nodeId);
      if (!node) return {};
      const candidates = [...(node.data.config.candidates || [])];
      const previous = candidates[index];
      candidates[index] = name;

      return withHistory(
        state,
        {
          nodes: state.nodes.map((n) =>
            n.id === nodeId ? { ...n, data: { ...n.data, config: { ...n.data.config, candidates } } } : n,
          ),
          edges: state.edges.map((e) =>
            e.source === nodeId && e.label === previous ? { ...e, label: name || undefined } : e,
          ),
        },
        `candidate:${nodeId}:${index}`,
      );
    }),

  setEdgeLabel: (id, label) =>
    set((state) => {
      const edge = state.edges.find((e) => e.id === id);
      // Renaming a condition branch would be a lie: the engine routes on the
      // handle, not on the label.
      if (!edge || isConditionEdge(edge)) return {};
      return withHistory(
        state,
        { edges: state.edges.map((e) => (e.id === id ? { ...e, label: label || undefined } : e)) },
        `edge-label:${id}`,
      );
    }),

  clearError: () => set({ lastError: null }),

  setShareToken: (shareToken) => set({ shareToken }),

  setTrigger: (key, value) => set((state) => ({ triggers: { ...state.triggers, [key]: value } })),

  markSaved: () => set({ dirty: false }),
}));
