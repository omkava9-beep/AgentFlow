import { create } from 'zustand';
import { applyNodeChanges, applyEdgeChanges } from 'reactflow';

let idCounter = 0;
const nextId = (prefix) => `${prefix}-${Date.now()}-${idCounter++}`;

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

export const useWorkflowStore = create((set, get) => ({
  workflowId: null,
  name: 'Untitled workflow',
  nodes: [],
  edges: [],
  selectedNodeId: null,
  dirty: false,
  lastError: null,

  loadWorkflow: (wf) =>
    set({
      workflowId: wf._id,
      name: wf.name,
      nodes: (wf.nodes || []).map(normalizeNode),
      edges: wf.edges || [],
      selectedNodeId: null,
      dirty: false,
      lastError: null,
    }),

  setName: (name) => set({ name, dirty: true }),

  onNodesChange: (changes) =>
    set((state) => ({ nodes: applyNodeChanges(changes, state.nodes), dirty: true })),

  onEdgesChange: (changes) =>
    set((state) => ({ edges: applyEdgeChanges(changes, state.edges), dirty: true })),

  addNode: (type, position) => {
    const { nodes } = get();
    if (type === 'start' && nodes.some((n) => n.type === 'start')) {
      set({ lastError: 'A workflow can only have one Start node.' });
      return;
    }
    const id = nextId(type);
    const defaultConfig = {
      start: { label: 'Start' },
      end: { label: 'End' },
      agent: { label: 'New Agent', systemPrompt: '', isHandoff: false, candidates: [] },
      tool: { label: 'New Tool', toolType: '' },
      condition: { label: 'Condition', expression: 'true' },
    }[type];

    const node = { id, type, position, data: { config: defaultConfig } };
    set({ nodes: [...nodes, node], dirty: true });
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
    set({ edges: [...edges, edge], dirty: true });
  },

  selectNode: (id) => set({ selectedNodeId: id }),

  updateNodeConfig: (id, patch) =>
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === id ? { ...n, data: { config: { ...n.data.config, ...patch } } } : n)),
      dirty: true,
    })),

  clearError: () => set({ lastError: null }),

  markSaved: () => set({ dirty: false }),
}));
