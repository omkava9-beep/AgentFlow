import { create } from 'zustand';
import { applyNodeChanges, applyEdgeChanges } from 'reactflow';
import { normalizeToolConfig } from '../utils/normalizeToolConfig.js';
import { OpClient, rejectMessage } from '../collab/opClient.js';
import {
  ops, applyOp, cleanNode, cleanEdge, deepCopy, deepEqual, diffConfig, getAtPath,
  isConditionEdge as isConditionEdgeOp, wouldCreateCycle,
} from '../collab/ops.js';
import { useToastStore } from './toastStore.js';

let idCounter = 0;
const nextId = (prefix) => `${prefix}-${Date.now()}-${idCounter++}`;

const HISTORY_LIMIT = 50;
/** Edits to the same field inside this window collapse into one history entry. */
const COALESCE_MS = 500;
const PASTE_OFFSET = 40;

const DEFAULT_CONFIGS = {
  start: { label: 'Start' },
  end: { label: 'End' },
  agent: { label: 'New Agent', systemPrompt: '', isHandoff: false, candidates: [] },
  tool: { label: 'New Tool', integration: '', action: '', connectionId: null, params: {} },
  condition: { label: 'Condition', expression: 'true' },
  // spec/31 advanced nodes.
  transform: { label: 'Transform', mode: 'replace', mappings: [{ key: '', value: '' }] },
  code: { label: 'Code', source: '// `input` is the upstream output; return the new value.\nreturn input;' },
  delay: { label: 'Delay', mode: 'duration', durationMs: 5000 },
  loop: { label: 'Loop', itemsPath: '{{input.items}}', workflowId: '', concurrency: 3, maxItems: 100, continueOnError: false },
  merge: { label: 'Merge', mode: 'any', output: 'keyed' },
  subworkflow: { label: 'Sub-workflow', workflowId: '', inputMapping: [] },
  // spec/32.
  approval: { label: 'Approval', title: 'Approve {{input}}?', description: '', assignees: { userIds: [], roles: [] }, minApprovals: 1, timeout: null, showInput: true },
};

/** Condition branches are matched by handle, so their labels aren't free text. */
export const isConditionEdge = isConditionEdgeOp;

function normalizeNode(n) {
  const raw = n.data?.config || { label: n.data?.label || n.type };
  // Legacy { toolType, toolConfig } tool nodes load in spec/26's shape.
  const config = n.type === 'tool' ? normalizeToolConfig(raw) : raw;
  return { ...n, data: { ...n.data, config } };
}

const toast = (message, tone = 'info') => {
  try {
    useToastStore.getState().push(message, tone);
  } catch {
    // no toast host (check scripts) - the message is still in lastError where relevant
  }
};

// ---------------------------------------------------------------------------
// The collaboration session (spec/28). One OpClient per loaded workflow; the
// socket transport (collab/transport.js) plugs its `send` in and feeds it acks,
// broadcasts and snapshots. With no transport attached the store still works -
// edits simply stay pending - which is what check:logic exercises.
// ---------------------------------------------------------------------------

let client = null;
/**
 * The live transport, if any (collab/transport.js). Kept here rather than on a
 * client so that a reload of the workflow - a new OpClient - stays connected:
 * the new client gets the same `send`, and the transport is told to resubscribe
 * for a snapshot (the new client has no confirmed seq yet).
 */
let transport = null;

/** Called by collab/transport.js; returns an unbind function. */
export function bindTransport(binding) {
  transport = binding;
  if (client) {
    client.send = binding.send;
    client.onGap = binding.onGap;
  }
  return () => {
    if (transport !== binding) return;
    transport = null;
    if (client) {
      client.send = null;
      client.onGap = () => {};
      client.ready = false;
    }
  };
}
/** Drag positions that are local until the drop (spec/28 §4: moves go out once, at drag end). */
const localDrag = new Map();
/** Peers' live drags: socketId -> Map<nodeId, position>. */
const remoteDrags = new Map();
/** Who last changed an entity field remotely, for "Bob edited it after you" toasts. */
const lastRemoteEditor = new Map();

/** Set by the presence layer: live-drag relay and name lookup for toasts. */
export const collabHooks = {
  onDrag: null, // (moves) => void
  onDragEnd: null, // () => void
  nameOf: () => null, // (userId) => string | null
};

export function getOpClient() {
  return client;
}

/** Identity used both for history coalescing and "who edited it after you". */
function atomIdentity(atom) {
  switch (atom.k) {
    case 'nodeField': return `nf:${atom.nodeId}:${JSON.stringify(atom.path)}`;
    case 'nodeMove': return `nm:${atom.nodeId}`;
    case 'edgeLabel': return `el:${atom.edgeId}`;
    case 'rename': return 'rename';
    default: return null;
  }
}

function opIdentities(op) {
  // Which history identities a remote op touches (for the undo-conflict toast).
  switch (op.type) {
    case 'batch': return op.ops.flatMap((o) => opIdentities(o));
    case 'node.update': {
      // A write at ['params'] also conflicts with an undo of ['params','city'].
      return [`nf:${op.nodeId}:${JSON.stringify(op.path)}`, `nf:${op.nodeId}:*`];
    }
    case 'node.move': return [`nm:${op.nodeId}`];
    case 'edge.update': return [`el:${op.edgeId}`];
    case 'workflow.rename': return ['rename'];
    default: return [];
  }
}

// --- history atoms ------------------------------------------------------------
// History stores what *you* changed as atoms with before/after values, computed
// from the view just before the op. Undo turns them into inverse ops - checked
// against the current view first, so an undo never clobbers a collaborator's
// newer edit (spec/28 §6).

function atomsFor(doc, op) {
  switch (op.type) {
    case 'batch': {
      const out = [];
      let running = doc;
      for (const inner of op.ops) {
        out.push(...atomsFor(running, inner));
        const r = applyOp(running, inner);
        if (r.ok) running = r.doc;
      }
      return out;
    }
    case 'node.add':
      return [{ k: 'nodeAdd', node: cleanNode(op.node) }];
    case 'node.move': {
      const node = doc.nodes.find((n) => n.id === op.nodeId);
      return node ? [{ k: 'nodeMove', nodeId: op.nodeId, before: { ...node.position }, after: { ...op.position } }] : [];
    }
    case 'node.update': {
      const node = doc.nodes.find((n) => n.id === op.nodeId);
      if (!node) return [];
      return [{ k: 'nodeField', nodeId: op.nodeId, path: op.path, before: deepCopy(getAtPath(node.data?.config, op.path)), after: deepCopy(op.value) }];
    }
    case 'node.delete': {
      const node = doc.nodes.find((n) => n.id === op.nodeId);
      if (!node) return [];
      const edges = doc.edges.filter((e) => e.source === op.nodeId || e.target === op.nodeId).map(cleanEdge);
      return [{ k: 'nodeDelete', node: cleanNode(node), edges }];
    }
    case 'edge.add':
      return [{ k: 'edgeAdd', edge: cleanEdge(op.edge) }];
    case 'edge.update': {
      const edge = doc.edges.find((e) => e.id === op.edgeId);
      return edge ? [{ k: 'edgeLabel', edgeId: op.edgeId, before: edge.label, after: op.value || undefined }] : [];
    }
    case 'edge.delete': {
      const edge = doc.edges.find((e) => e.id === op.edgeId);
      return edge ? [{ k: 'edgeDelete', edge: cleanEdge(edge) }] : [];
    }
    case 'workflow.rename':
      return [{ k: 'rename', before: doc.name, after: op.name }];
    default:
      return [];
  }
}

/** Coalescing keeps each field's first `before` and latest `after`. */
function mergeAtoms(existing, incoming) {
  const out = existing.map((a) => ({ ...a }));
  for (const atom of incoming) {
    const id = atomIdentity(atom);
    const match = id && out.find((a) => atomIdentity(a) === id);
    if (match) match.after = atom.after;
    else out.push(atom);
  }
  return out;
}

const describeAtom = (atom, doc) => {
  const nodeLabel = (id) => doc.nodes.find((n) => n.id === id)?.data?.config?.label;
  switch (atom.k) {
    case 'nodeField': return `the ${atom.path[atom.path.length - 1]} change${nodeLabel(atom.nodeId) ? ` on “${nodeLabel(atom.nodeId)}”` : ''}`;
    case 'nodeMove': return 'the move';
    case 'edgeLabel': return 'the label change';
    case 'rename': return 'the rename';
    default: return 'that change';
  }
};

/**
 * Turns atoms into the ops that reverse them (`direction: 'undo'`) or reapply
 * them (`'redo'`), skipping any part a collaborator has changed since.
 * Returns `{ ops, skipped: [atom] }`.
 */
function planHistory(atoms, direction, doc) {
  const list = direction === 'undo' ? [...atoms].reverse() : atoms;
  const planned = [];
  const skipped = [];
  let running = doc;
  const exists = (id) => running.nodes.some((n) => n.id === id);
  const edgeExists = (id) => running.edges.some((e) => e.id === id);
  const push = (op, atom) => {
    const r = applyOp(running, op);
    if (r.ok) {
      running = r.doc;
      planned.push(op);
    } else if (atom) skipped.push(atom);
  };

  for (const atom of list) {
    const from = direction === 'undo' ? atom.after : atom.before;
    const to = direction === 'undo' ? atom.before : atom.after;
    switch (atom.k) {
      case 'nodeField': {
        const node = running.nodes.find((n) => n.id === atom.nodeId);
        if (!node || !deepEqual(getAtPath(node.data?.config, atom.path), from)) skipped.push(atom);
        else push(ops.nodeUpdate(atom.nodeId, atom.path, to), atom);
        break;
      }
      case 'nodeMove': {
        const node = running.nodes.find((n) => n.id === atom.nodeId);
        if (!node || !deepEqual(node.position, from)) skipped.push(atom);
        else push(ops.nodeMove(atom.nodeId, to), atom);
        break;
      }
      case 'edgeLabel': {
        const edge = running.edges.find((e) => e.id === atom.edgeId);
        if (!edge || (edge.label || undefined) !== (from || undefined)) skipped.push(atom);
        else push(ops.edgeUpdate(atom.edgeId, to), atom);
        break;
      }
      case 'rename':
        if (running.name !== from) skipped.push(atom);
        else push(ops.rename(to), atom);
        break;
      case 'nodeAdd':
      case 'nodeDelete': {
        // undo(add) and redo(delete) remove the node; the other two re-add it
        // with its original id (so comment threads reattach, spec/29).
        const removing = (atom.k === 'nodeAdd') === (direction === 'undo');
        if (removing) {
          if (exists(atom.node.id)) push(ops.nodeDelete(atom.node.id), atom);
        } else if (!exists(atom.node.id)) {
          push(ops.nodeAdd(atom.node), atom);
          for (const edge of atom.edges || []) {
            if (!edgeExists(edge.id) && exists(edge.source) && exists(edge.target)) push(ops.edgeAdd(edge), null);
          }
        }
        break;
      }
      case 'edgeAdd':
      case 'edgeDelete': {
        const removing = (atom.k === 'edgeAdd') === (direction === 'undo');
        if (removing) {
          if (edgeExists(atom.edge.id)) push(ops.edgeDelete(atom.edge.id), atom);
        } else if (!edgeExists(atom.edge.id) && exists(atom.edge.source) && exists(atom.edge.target)) {
          push(ops.edgeAdd(atom.edge), atom);
        }
        break;
      }
      default:
        break;
    }
  }
  return { ops: planned, skipped };
}

// --- rendering the view into React Flow state ---------------------------------

/** Local UI fields survive a recompute; everything shared comes from the view. */
function render(state, view, { select = null, selectEdges = null } = {}) {
  const prevNodes = new Map(state.nodes.map((n) => [n.id, n]));
  const prevEdges = new Map(state.edges.map((e) => [e.id, e]));
  const remotePositions = new Map();
  for (const moves of remoteDrags.values()) for (const [id, pos] of moves) remotePositions.set(id, pos);

  const nodes = view.nodes.map((n) => {
    const prev = prevNodes.get(n.id);
    const out = { ...n };
    if (prev) {
      if (prev.selected !== undefined) out.selected = prev.selected;
      if (prev.width !== undefined) out.width = prev.width;
      if (prev.height !== undefined) out.height = prev.height;
      if (prev.dragging) out.dragging = prev.dragging;
    }
    if (select) out.selected = select.has(n.id);
    const pos = localDrag.get(n.id) || remotePositions.get(n.id);
    if (pos) out.position = pos;
    return out;
  });
  const edges = view.edges.map((e) => {
    const prev = prevEdges.get(e.id);
    const out = { ...e };
    if (prev?.selected !== undefined) out.selected = prev.selected;
    if (selectEdges) out.selected = selectEdges.has(e.id);
    else if (select && prev?.selected) out.selected = false;
    return out;
  });

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edgeIds = new Set(edges.map((e) => e.id));
  const pendingCount = client ? client.pendingCount : 0;
  return {
    name: view.name,
    nodes,
    edges,
    selectedNodeId: nodeIds.has(state.selectedNodeId) ? state.selectedNodeId : null,
    selectedEdgeId: edgeIds.has(state.selectedEdgeId) ? state.selectedEdgeId : null,
    pendingCount,
    // `dirty` now means "not yet confirmed by the server" (spec/28 §9).
    dirty: pendingCount > 0,
  };
}

const EMPTY_DOC = { name: 'Untitled workflow', nodes: [], edges: [] };

export const useWorkflowStore = create((set, get) => {
  /** Applies a local op through the OpClient and records it as one history step. */
  function commit(bareOp, { coalesceKey = null, select = null, selectEdges = null, history = true, lastError = null } = {}) {
    const state = get();
    if (state.readOnly) return { ok: false, reason: 'forbidden' };
    const before = client.view;
    const result = client.local(bareOp);
    if (!result.ok) {
      set({ lastError: result.message || 'That change is not allowed.' });
      return result;
    }
    const patch = { ...render(get(), client.view, { select, selectEdges }), lastError };
    if (history) {
      const atoms = atomsFor(before, result.op);
      const now = Date.now();
      const continuing = coalesceKey && state.coalesceKey === coalesceKey && now - state.coalesceAt < COALESCE_MS && state.past.length;
      const past = continuing
        ? [...state.past.slice(0, -1), { ...state.past[state.past.length - 1], atoms: mergeAtoms(state.past[state.past.length - 1].atoms, atoms) }]
        : [...state.past, { atoms, at: now }].slice(-HISTORY_LIMIT);
      Object.assign(patch, { past, future: [], coalesceKey: coalesceKey || null, coalesceAt: coalesceKey ? now : 0 });
    }
    set(patch);
    return result;
  }

  /** Sends one or many ops as a single op (a batch when there are several). */
  const one = (list) => (list.length === 1 ? list[0] : ops.batch(list));

  function onClientChange() {
    set(render(get(), client.view));
  }

  function onReject(op, ack) {
    const message = rejectMessage(op, ack, (id) => collabHooks.nameOf(id));
    toast(message, 'error');
    // A rejected drop snaps the node back to its confirmed position.
    set(render(get(), client.view));
  }

  function makeClient() {
    const c = new OpClient({ onChange: onClientChange, onReject });
    if (transport) {
      c.send = transport.send;
      c.onGap = transport.onGap;
    }
    return c;
  }

  client = makeClient();

  function runHistory(direction) {
    const state = get();
    if (state.readOnly) return;
    const stack = direction === 'undo' ? state.past : state.future;
    if (!stack.length) return;
    const entry = direction === 'undo' ? stack[stack.length - 1] : stack[0];
    const { ops: planned, skipped } = planHistory(entry.atoms, direction, client.view);

    for (const atom of skipped) {
      const id = atomIdentity(atom);
      const by = (id && (lastRemoteEditor.get(id) || lastRemoteEditor.get(id.replace(/:\[.*$/, ':*')))) || null;
      const who = by ? collabHooks.nameOf(by) : null;
      toast(`Couldn't ${direction} ${describeAtom(atom, client.view)} — ${who || 'someone else'} edited it after you.`, 'info');
    }
    if (planned.length) client.local(one(planned));

    const rest = direction === 'undo' ? state.past.slice(0, -1) : state.future.slice(1);
    set({
      ...render(get(), client.view),
      ...(direction === 'undo'
        ? { past: rest, future: [entry, ...state.future].slice(0, HISTORY_LIMIT) }
        : { future: rest, past: [...state.past, entry].slice(-HISTORY_LIMIT) }),
      coalesceKey: null,
      coalesceAt: 0,
    });
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
        // Deep copy: a shallow one would alias arrays like `candidates`, so
        // editing the clone would silently edit the original.
        data: { config: deepCopy(n.data?.config || DEFAULT_CONFIGS[n.type] || {}) },
      });
    }
    // Only edges wholly inside the selection survive; ones leaving it are dropped.
    const edges = sourceEdges
      .filter((e) => idMap.has(e.source) && idMap.has(e.target))
      .map((e) => cleanEdge({ ...e, id: nextId('edge'), source: idMap.get(e.source), target: idMap.get(e.target) }));
    return { nodes, edges, droppedStart };
  }

  return {
    workflowId: null,
    name: EMPTY_DOC.name,
    nodes: [],
    edges: [],
    selectedNodeId: null,
    selectedEdgeId: null,
    dirty: false,
    pendingCount: 0,
    lastError: null,
    readOnly: false,
    // 'offline' until the transport connects; 'collab' with the hub, 'rest' when
    // the server has no hub and saves fall back to a debounced PUT.
    connection: 'offline',
    restError: null,
    // Triggers are saved through their own endpoints the moment they change, so
    // they're deliberately outside the graph's ops and undo state.
    triggers: { schedule: null, webhook: null, eventTrigger: null },
    shareToken: null,

    past: [],
    future: [],
    clipboard: null,
    coalesceKey: null,
    coalesceAt: 0,
    pendingGesture: null,

    loadWorkflow: (wf) => {
      const replaced = Boolean(client && transport);
      client = makeClient();
      localDrag.clear();
      remoteDrags.clear();
      lastRemoteEditor.clear();
      const doc = { name: wf.name, nodes: (wf.nodes || []).map(normalizeNode), edges: wf.edges || [] };
      client.reset(doc, { seq: wf.draftSeq || 0 });
      set({
        workflowId: wf._id,
        name: doc.name,
        nodes: doc.nodes,
        edges: doc.edges,
        triggers: {
          schedule: wf.schedule || null,
          webhook: wf.webhook || null,
          eventTrigger: wf.eventTrigger || null,
        },
        shareToken: wf.shareToken || null,
        selectedNodeId: null,
        selectedEdgeId: null,
        dirty: false,
        pendingCount: 0,
        lastError: null,
        restError: null,
        connection: 'offline',
        // History is per editing session. An empty `past` is what makes undo stop
        // at the load point rather than emptying a canvas the user never emptied.
        past: [],
        future: [],
        clipboard: null,
        pendingGesture: null,
        // Reset the coalesce window too: otherwise the first edit after opening a
        // workflow can be folded into the *previous* workflow's window.
        coalesceKey: null,
        coalesceAt: 0,
      });
      // A reload under a live session: ask for a fresh snapshot for the new client.
      if (replaced) transport.onClientReplaced?.();
    },

    // --- collaboration plumbing (called by collab/transport.js) --------------
    setReadOnly: (readOnly) => set({ readOnly }),
    setConnection: (connection) => set({ connection }),
    setRestError: (restError) => set({ restError }),

    /** A server snapshot replaced the document (spec/28 §7, §8). */
    applySnapshot: (snap, { clearHistory = false } = {}) => {
      const normalized = { ...snap, nodes: (snap.nodes || []).map(normalizeNode) };
      client.snapshot(normalized);
      set({
        ...render(get(), client.view),
        ...(clearHistory && { past: [], future: [], coalesceKey: null, coalesceAt: 0 }),
      });
    },

    applyCatchUp: (catchUp) => {
      const ok = client.catchUp(catchUp);
      if (ok) set(render(get(), client.view));
      return ok;
    },

    applyRemote: (payload) => {
      const applied = client.remote(payload);
      if (applied) {
        for (const id of opIdentities(payload.op)) lastRemoteEditor.set(id, payload.by?.userId);
        // Their drop ends their live drag.
        if (payload.by?.socketId && (payload.op.type === 'node.move' || payload.op.type === 'batch')) {
          remoteDrags.delete(payload.by.socketId);
          set(render(get(), client.view));
        }
      }
      return applied;
    },

    setRemoteDrag: (socketId, moves) => {
      if (!moves?.length) remoteDrags.delete(socketId);
      else remoteDrags.set(socketId, new Map(moves.map((m) => [m.nodeId, m.position])));
      set(render(get(), client.view));
    },

    clearRemoteDrag: (socketId) => {
      if (!remoteDrags.delete(socketId)) return;
      set(render(get(), client.view));
    },

    /** REST fallback: a whole-document save succeeded. */
    commitAll: (doc) => {
      client.commitAll(doc);
      set({ ...render(get(), client.view), restError: null });
    },

    /** REST fallback: the first `count` pending ops were saved as `doc`. */
    commitPrefix: (count, doc) => {
      client.commitPrefix(count, doc);
      set({ ...render(get(), client.view), restError: null });
    },

    /** The document as it stands (confirmed + pending), without local UI fields. */
    currentDocument: () => ({ name: client.view.name, nodes: client.view.nodes.map(cleanNode), edges: client.view.edges.map(cleanEdge) }),

    setName: (name) => {
      if (name === get().name) return;
      commit(ops.rename(name), { coalesceKey: 'name' });
    },

    onNodesChange: (changes) => {
      const state = get();
      const gesture = Boolean(state.pendingGesture);
      const immediateMoves = [];
      for (const c of changes) {
        if (c.type !== 'position' || !c.position) continue;
        if (gesture || c.dragging) localDrag.set(c.id, { ...c.position });
        else immediateMoves.push(c);
      }
      // Selection, dimensions and in-progress drag positions are local UI state.
      set({ nodes: applyNodeChanges(changes.filter((c) => c.type !== 'remove'), state.nodes) });
      if (gesture && localDrag.size && collabHooks.onDrag) {
        collabHooks.onDrag([...localDrag.entries()].map(([nodeId, position]) => ({ nodeId, position })));
      }
      if (immediateMoves.length && !state.readOnly) {
        commit(one(immediateMoves.map((c) => ops.nodeMove(c.id, c.position))));
      }
    },

    onEdgesChange: (changes) =>
      set((state) => ({ edges: applyEdgeChanges(changes.filter((c) => c.type !== 'remove'), state.edges) })),

    // --- drag gestures -------------------------------------------------------
    // React Flow fires onNodesChange per mouse-move. Those positions stay local
    // (and go to peers as presence); one node.move op - or a batch for a
    // multi-node drag - goes out at the drop, as one history entry.
    beginGesture: () => set({ pendingGesture: { at: Date.now() } }),

    endGesture: () => {
      const state = get();
      if (!state.pendingGesture) return;
      const moves = [];
      for (const [nodeId, position] of localDrag) {
        const node = client.view.nodes.find((n) => n.id === nodeId);
        if (node && (node.position.x !== position.x || node.position.y !== position.y)) moves.push(ops.nodeMove(nodeId, position));
      }
      localDrag.clear();
      collabHooks.onDragEnd?.();
      set({ pendingGesture: null });
      if (moves.length && !state.readOnly) commit(one(moves));
      else set(render(get(), client.view));
    },

    // --- history (per user, spec/28 §6) ---------------------------------------
    undo: () => runHistory('undo'),
    redo: () => runHistory('redo'),

    // --- graph edits ---------------------------------------------------------
    addNode: (type, position) => {
      if (type === 'start' && client.view.nodes.some((n) => n.type === 'start')) {
        set({ lastError: 'A workflow can only have one Start node.' });
        return;
      }
      const node = { id: nextId(type), type, position, data: { config: deepCopy(DEFAULT_CONFIGS[type] || { label: type }) } };
      commit(ops.nodeAdd(node));
    },

    connect: (connection) => {
      const { nodes, edges } = client.view;
      if (connection.source === connection.target) return;
      if (wouldCreateCycle(nodes, edges, connection.source, connection.target)) {
        set({ lastError: 'That connection would create a cycle, which is not allowed.' });
        return;
      }
      const edge = {
        id: nextId('edge'),
        source: connection.source,
        target: connection.target,
        ...(connection.sourceHandle && { sourceHandle: connection.sourceHandle }),
        ...(connection.sourceHandle === 'true' && { label: 'true' }),
        ...(connection.sourceHandle === 'false' && { label: 'false' }),
      };
      commit(ops.edgeAdd(edge));
    },

    deleteSelection: () => {
      const state = get();
      const nodeIds = new Set(state.nodes.filter((n) => n.selected).map((n) => n.id));
      const edgeIds = state.edges
        .filter((e) => e.selected && !nodeIds.has(e.source) && !nodeIds.has(e.target))
        .map((e) => e.id);
      if (!nodeIds.size && !edgeIds.length) return;
      // Edges first, then nodes: the server cascades each node's remaining edges.
      const list = [...edgeIds.map(ops.edgeDelete), ...[...nodeIds].map(ops.nodeDelete)];
      const result = commit(one(list));
      if (result.ok) {
        set((s) => ({
          selectedNodeId: nodeIds.has(s.selectedNodeId) ? null : s.selectedNodeId,
          selectedEdgeId: edgeIds.includes(s.selectedEdgeId) ? null : s.selectedEdgeId,
        }));
      }
    },

    copySelection: () => {
      const { nodes, edges } = get();
      const selected = nodes.filter((n) => n.selected);
      if (!selected.length) return;
      const ids = new Set(selected.map((n) => n.id));
      set({
        clipboard: {
          nodes: selected.map((n) => ({ id: n.id, type: n.type, position: n.position, data: { config: deepCopy(n.data.config) } })),
          edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map(cleanEdge),
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

    _insert: (sourceNodes, sourceEdges) => {
      const { nodes, edges, droppedStart } = cloneGraph(sourceNodes, sourceEdges, {
        offset: PASTE_OFFSET,
        hasStart: client.view.nodes.some((n) => n.type === 'start'),
      });
      if (!nodes.length) {
        set({ lastError: droppedStart ? 'A workflow can only have one Start node.' : null });
        return;
      }
      // One atomic batch: paste/duplicate lands (and undoes) as a single step.
      commit(one([...nodes.map(ops.nodeAdd), ...edges.map(ops.edgeAdd)]), {
        select: new Set(nodes.map((n) => n.id)),
        selectEdges: new Set(),
        lastError: droppedStart ? 'Skipped the Start node - a workflow can only have one.' : null,
      });
    },

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

    /**
     * Config edits become path-level node.update ops (spec/28 §2): nested
     * objects like `params` diff down to the leaf that changed, so two people
     * editing different fields of one node both survive.
     */
    updateNodeConfig: (id, patch) => {
      const node = client.view.nodes.find((n) => n.id === id);
      if (!node) return;
      const current = node.data?.config || {};
      const changes = diffConfig(current, { ...current, ...patch });
      if (!changes.length) return;
      commit(one(changes.map((c) => ops.nodeUpdate(id, c.path, c.value))), {
        coalesceKey: `config:${id}:${Object.keys(patch).join(',')}`,
      });
    },

    // --- handoff candidates (spec/16) ----------------------------------------
    // Renaming a candidate *does* rewrite matching outgoing edge labels: it's the
    // same branch being renamed. Adding or removing a candidate deliberately does
    // NOT touch edges - that drift is real, and the validation panel says so.
    addHandoffCandidate: (nodeId) => {
      const node = client.view.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const candidates = node.data.config.candidates || [];
      commit(ops.nodeUpdate(nodeId, ['candidates'], [...candidates, `candidate-${candidates.length + 1}`]));
    },

    removeHandoffCandidate: (nodeId, index) => {
      const node = client.view.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const candidates = (node.data.config.candidates || []).filter((_, i) => i !== index);
      commit(ops.nodeUpdate(nodeId, ['candidates'], candidates));
    },

    renameHandoffCandidate: (nodeId, index, name) => {
      const { nodes, edges } = client.view;
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const candidates = [...(node.data.config.candidates || [])];
      const previous = candidates[index];
      candidates[index] = name;
      const relabels = edges
        .filter((e) => e.source === nodeId && e.label === previous && !isConditionEdge(e))
        .map((e) => ops.edgeUpdate(e.id, name || undefined));
      // Atomic: the candidate and its edge labels move together (spec/28 §2 batch).
      commit(one([ops.nodeUpdate(nodeId, ['candidates'], candidates), ...relabels]), {
        coalesceKey: `candidate:${nodeId}:${index}`,
      });
    },

    setEdgeLabel: (id, label) => {
      const edge = client.view.edges.find((e) => e.id === id);
      // Renaming a condition branch would be a lie: the engine routes on the
      // handle, not on the label.
      if (!edge || isConditionEdge(edge)) return;
      if ((edge.label || '') === (label || '')) return;
      commit(ops.edgeUpdate(id, label || undefined), { coalesceKey: `edge-label:${id}` });
    },

    clearError: () => set({ lastError: null }),

    setShareToken: (shareToken) => set({ shareToken }),

    setTrigger: (key, value) => set((state) => ({ triggers: { ...state.triggers, [key]: value } })),

    setTriggers: (triggers) => set((state) => ({ triggers: { ...state.triggers, ...triggers } })),

    /** Kept for callers from before spec/28: confirms everything pending. */
    markSaved: () => {
      client.commitAll();
      set(render(get(), client.view));
    },
  };
});
