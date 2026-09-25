# Spec: Builder UX Depth

**Status:** Phase 2 extension
**Milestone:** M3
**Depends on:** `02-workflow-builder-canvas.md`, `03-node-configuration-panel.md`

> **Revised in phase 3:** Undo/redo is per user (inverse ops), Save is replaced by autosave, and the "no collaborative editing" non-goal no longer applies ([`28`](28-realtime-collaboration.md)); validation gains rules for the new node types ([`31`](31-advanced-nodes.md)) and is ported to the server for publish ([`30`](30-workflow-versioning.md)).

## Summary

Brings the canvas up to the level of editing comfort the rest of the app implies: undo/redo, duplication, edge label editing, and a live validation panel that explains why a graph won't run — replacing the current single-line error string.

Phase 1's builder can add nodes, connect them (with client-side cycle prevention), configure them, and save. Everything past that is missing: one mis-drag is unrecoverable, a five-node subgraph must be rebuilt by hand, edge labels can only be set implicitly by which handle you drag from, and validation is two `if` statements in `Builder.jsx` that surface one message at a time.

## Goals

### 1. Undo / redo

- A bounded history stack (50 entries) in `workflowStore`, capturing `{ nodes, edges, name }` snapshots.
- `Cmd/Ctrl+Z` undoes, `Shift+Cmd/Ctrl+Z` (and `Ctrl+Y`) redoes. Toolbar buttons mirror both, disabled when the respective stack is empty.
- **Coalescing matters more than it sounds.** React Flow fires `onNodesChange` on every mouse-move during a drag; snapshotting each one would fill the entire stack with a single gesture. Commit one snapshot per *gesture*: push on `dragstop`/`selectionchange` boundaries and on discrete actions (add, delete, connect, config edit), not on every change event. Debounce config-panel typing to one entry per field per idle-pause (~500ms).
- Undo restores selection state alongside the graph, so undoing a delete re-selects what came back.

### 2. Copy / paste / duplicate

- `Cmd/Ctrl+D` duplicates the current selection in place, offset by ~(40, 40).
- `Cmd/Ctrl+C` / `Cmd/Ctrl+V` copy and paste, pasting at the pointer position when known and offset from the original otherwise.
- Every pasted node gets a fresh id from the store's `nextId()`, and its `data.config` is **deep-copied** — a shallow copy would leave the clone's `candidates` array (`16`) aliased to the original's, so editing one would silently edit the other.
- Pasting a multi-node selection preserves edges **internal** to that selection, remapped to the new ids. Edges to nodes outside the selection are dropped.
- Duplicating a `start` node is refused with the existing "only one Start node" message — the guard already in `addNode` must also cover this path.

### 3. Keyboard deletion

- `Delete`/`Backspace` removes the selected nodes and edges, cascading edge cleanup for removed nodes.
- Suppressed while focus is inside a text input, so typing in the config panel or the workflow-name field never eats a node.

### 4. Edge editing

Currently an edge's `label` is set once at connect time (`'true'`/`'false'` from the source handle, `undefined` otherwise) and can never be changed. `16-agent-handoff.md` requires arbitrary edge labels matching a handoff node's `candidates`, so this is a hard prerequisite for that spec.

- Clicking an edge selects it and opens an inline label editor.
- Condition edges keep their `true`/`false` labels bound to `sourceHandle` and are not freely renamable — the engine matches on the handle, so a renamed label would be a lie.
- For an edge whose source is a handoff agent, the label editor offers that node's `candidates` as a dropdown rather than free text, keeping the two in sync by construction.
- Selected edges render visibly distinct (thicker, accent colour).

### 5. Live validation panel

Replaces the single `serverError || lastError` string with a collapsible panel listing every current problem, each clicking through to select the offending node.

**Errors** (block save):
- No `start` node.
- No nodes at all.
- Graph contains a cycle (the store already computes this on connect; surface it as standing state too).

**Warnings** (allow save, block run):
- A `tool` node with no `toolType` selected.
- A `tool` node whose `toolType` isn't in the live `GET /api/tools` list — the "unknown tool type" case `03` and `15` both reference.
- A `condition` node whose expression fails to parse (already computed in `NodeConfigPanel`, currently local to that component).
- A `condition` node without both a `true` and a `false` outgoing edge.
- A handoff agent whose `candidates` don't exactly match its outgoing edge labels.
- Nodes unreachable from `start`.
- More than one `end` node, or none.

The error/warning split is the useful part: phase 1 blocks *saving* on a missing Start node, which means an in-progress graph can't be parked. Saving should be permissive and running should be strict.

### 6. Unsaved-changes guard

`dirty` already blocks the Run button. Extend it to warn on navigating away from the Builder (React Router blocker + `beforeunload`), because losing an unsaved graph to a stray back-button press is the most expensive mistake the current UI allows.

`useBlocker` only works under a **data router**, so `<BrowserRouter>` becomes `createBrowserRouter` + `RouterProvider`. The route tree stays JSX via `createRoutesFromElements` — this is a wiring change in `main.jsx`/`App.jsx`, not a rewrite. `beforeunload` alone would cover reload and tab-close but not in-app navigation, which is the case that actually loses work.

## Non-goals

- Real-time collaborative editing / presence. Single-user, per `PRODUCT.md`.
- Subflows, node groups, or collapsible clusters.
- Alignment guides, snapping, or auto-layout beyond React Flow's defaults.
- Undo/redo of *server* state — history is local to an unsaved editing session and resets on load. Undo does not roll back a completed save.
- A command palette / fuzzy node search. The palette has five node types; it doesn't need search.

## Data Model

No server-side changes. Client store gains:

```
past:    Array<{ nodes, edges, name, selectedNodeId }>   // bounded to 50
future:  Array<{ nodes, edges, name, selectedNodeId }>
clipboard: { nodes, edges } | null
selectedEdgeId: string | null
```

`clipboard` is in-memory only — no system-clipboard integration, so copying in one tab and pasting in another is out of scope.

## UI Behavior

- Toolbar (left of Save) gains Undo / Redo / Duplicate buttons with keyboard hints in their tooltips.
- Validation panel sits bottom-left of the canvas, collapsed to a summary pill (`2 warnings`) and expandable to the full list. Green "Ready to run" state when clean.
- Save is disabled while any **error** is present, with the reason in its tooltip. Run is disabled while any error *or* warning is present, or while `dirty`.
- The Node Config Panel's expression validation moves into the shared validation state so the same problem isn't reported in two places with two different phrasings.

## Edge Cases & Error Handling

- **Undo past the load point** → stops at the loaded state; the stack is seeded with the freshly-loaded graph, so undo can never produce an empty canvas the user didn't create.
- **Undo after save** → the graph reverts and `dirty` becomes `true` again. Undo is not a rollback of the save; the reverted state is simply unsaved.
- **Paste with nothing copied** → no-op, no error toast.
- **Deleting a handoff agent's outgoing edge** → the candidate list keeps the now-orphaned name and the validation panel reports the mismatch, rather than silently mutating the node's config. Config edits stay explicit.
- **Duplicating a node with a `failureRate` override** (`17`) → the override is copied with it; that is the expected meaning of duplicate.
- **Keyboard shortcuts inside the config panel** → all canvas shortcuts are suppressed while an `input`, `textarea`, or `contenteditable` has focus.

## Acceptance Criteria

- [ ] Dragging a node, then pressing `Cmd+Z`, restores its previous position in one undo — not fifty.
- [ ] Deleting three selected nodes and undoing restores all three plus every edge that connected them.
- [ ] Duplicating a two-node selection joined by an edge produces two new nodes joined by a new edge, with the original untouched.
- [ ] Editing a duplicated handoff agent's `candidates` leaves the original's `candidates` unchanged (deep-copy check).
- [ ] An edge's label can be renamed after creation and the change survives save/reload.
- [ ] A `true`/`false` condition edge cannot be renamed to something the engine won't match.
- [ ] A graph with an unconfigured tool node saves successfully but refuses to run, naming that node in the validation panel.
- [ ] Clicking a validation entry reveals the offending node — opens its inspector *and* highlights it on the canvas.
- [ ] Navigating away with unsaved changes prompts for confirmation; navigating away after save does not.
- [ ] Typing `Backspace` in the workflow-name field deletes a character, not a node.
