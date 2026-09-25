import { create } from 'zustand';

const read = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked - the preference just isn't remembered */
  }
};

/**
 * Local, per-browser canvas UI state - nothing here is part of the workflow or
 * synced to collaborators. Nodes read it to render inline rename, validation
 * dots and run-status overlays; the Builder and inspector write it.
 */
export const useCanvasUi = create((set) => ({
  /** Node being renamed inline on the canvas (F2 / "Rename"). */
  renamingNodeId: null,
  startRename: (id) => set({ renamingNodeId: id }),
  stopRename: () => set({ renamingNodeId: null }),

  /** Inspector tab: settings | advanced | output | docs. */
  inspectorTab: 'settings',
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  inspectorWidth: read('agentflow:inspector-width', 360),
  setInspectorWidth: (w) => {
    const width = Math.max(300, Math.min(640, Math.round(w)));
    write('agentflow:inspector-width', width);
    set({ inspectorWidth: width });
  },

  /** { [nodeId]: { level: 'error'|'warning'|'info', messages: [] } } from validateGraph. */
  problems: {},
  setProblems: (problems) => set({ problems }),

  /** The workflow's latest run (for overlays and the inspector's Output tab). */
  latestRun: null,
  setLatestRun: (latestRun) => set({ latestRun }),
  showRunOverlay: false,
  toggleRunOverlay: () => set((s) => ({ showRunOverlay: !s.showRunOverlay })),

  snapToGrid: read('agentflow:canvas-snap', false),
  toggleSnap: () => set((s) => { write('agentflow:canvas-snap', !s.snapToGrid); return { snapToGrid: !s.snapToGrid }; }),
  /** null = automatic (shown only for graphs big enough to need it); true/false once toggled. */
  minimapPref: read('agentflow:canvas-minimap', null),
  toggleMinimap: (currentlyShown) => set(() => { write('agentflow:canvas-minimap', !currentlyShown); return { minimapPref: !currentlyShown }; }),

  /**
   * An "add a node" request from somewhere on the canvas - the pane menu, an
   * edge's "Insert node here", a handle's quick "+", or a connection dropped on
   * empty canvas. The Builder opens the AddNodeMenu at `screen` and routes the
   * pick back through `kind`:
   *   { kind: 'here', screen, flow }
   *   { kind: 'edge', screen, flow, edgeId }
   *   { kind: 'connect', screen, flow, from: { nodeId, handleId, handleType } }
   */
  addRequest: null,
  requestAdd: (addRequest) => set({ addRequest }),
  clearAddRequest: () => set({ addRequest: null }),

  /** A "comment here" request handed to the comments layer: { anchor, flow, nonce }. */
  commentRequest: null,
  requestComment: (anchor, flow) => set({ commentRequest: { anchor, flow, nonce: Date.now() } }),
}));
