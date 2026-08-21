# Plan: Builder UX Depth

**Spec:** [`spec/20-builder-ux.md`](../spec/20-builder-ux.md)
**Depends on:** `02-workflow-builder-canvas`, `03-node-configuration-panel`

Build before `16-agent-handoff` — arbitrary edge-label editing is a prerequisite for handoff candidate sync.

> **Status: complete.** Verified two ways: 37 logic checks over the store and validator
> (drag coalescing, delete/undo, clone independence, label rules, history bound, every
> validation rule), plus a 16-check headless-Chrome pass driving the real app — boot on the
> migrated router, palette → canvas, validation pill, save-permissive/run-strict, undo/redo
> round-trip, and `confirm()` actually firing and cancelling in-app navigation while dirty.
>
> One structural change beyond the task list, now in `spec/20`: `useBlocker` requires a
> **data router**, so `<BrowserRouter>` became `createBrowserRouter` + `RouterProvider`
> (routes still declared as JSX via `createRoutesFromElements`). `beforeunload` alone would
> have covered reload and tab-close but not in-app navigation — the case that actually loses
> work. Also added `focusNode` so a validation entry highlights the node on the canvas rather
> than only opening its inspector.

## Backend Tasks

None. Entirely client-side (server-side cycle validation lives in `19`).

## Frontend Tasks

### History (`store/workflowStore.js`)

- [x] `past` / `future` snapshot stacks of `{ nodes, edges, name, selectedNodeId }`, `past` bounded to 50 entries
- [x] `commit()` helper that pushes the current state onto `past` and clears `future`; call it from discrete actions (`addNode`, `connect`, delete, `updateNodeConfig`, `setName`)
- [x] **Coalesce drag gestures** — React Flow fires `onNodesChange` per mouse-move, so snapshotting each one would fill the stack from a single drag. Commit on gesture boundaries (`onNodeDragStop`, selection change) rather than inside `onNodesChange`
- [x] Debounce config-panel/name typing to one history entry per field per ~500ms idle
- [x] `undo()` / `redo()` restoring graph *and* selection; seed `past` with the freshly-loaded graph so undo can't empty a canvas the user never emptied
- [x] Undo after a save sets `dirty: true` again (undo is not a save rollback)

### Clipboard & deletion

- [x] `clipboard: { nodes, edges } | null` in the store (in-memory only, no system clipboard)
- [x] `copySelection()` / `paste(position?)` / `duplicateSelection()`
- [x] Fresh ids via `nextId()`; **deep-copy `data.config`** — a shallow copy aliases arrays like `candidates`, so editing a clone would mutate the original
- [x] Preserve edges internal to the pasted selection (remapped to new ids); drop edges leaving it
- [x] Refuse to duplicate a `start` node, reusing `addNode`'s existing single-Start guard
- [x] `deleteSelection()` with cascading edge cleanup

### Keyboard layer

- [x] `hooks/useCanvasShortcuts.js` — `Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z`, `Ctrl+Y`, `Cmd/Ctrl+C`, `Cmd/Ctrl+V`, `Cmd/Ctrl+D`, `Delete`/`Backspace`
- [x] Suppress every shortcut while focus is in an `input` / `textarea` / `contenteditable` — otherwise Backspace in the name field deletes a node

### Edge editing

- [x] `selectedEdgeId` in the store; `onEdgeClick` selects
- [x] Inline label editor for the selected edge; free text for normal edges
- [x] Condition edges (`sourceHandle` `true`/`false`) keep bound labels and are **not** renamable — the engine matches on the handle, so a renamed label would be a lie
- [x] For edges out of a handoff agent, offer that node's `candidates` as a dropdown so labels and candidates stay in sync by construction
- [x] Custom edge styling for the selected edge (thicker + accent colour)

### Validation panel

- [x] `utils/validateGraph.js` — pure `(nodes, edges, availableToolTypes) → { errors[], warnings[] }`, each entry `{ nodeId?, message }`
- [x] Errors: no nodes; no `start` node; cycle present
- [x] Warnings: tool node with no `toolType`; `toolType` not in `GET /api/tools`; unparseable condition expression; condition missing a `true` or `false` edge; handoff candidates ≠ outgoing edge labels; nodes unreachable from `start`; zero or multiple `end` nodes
- [x] `components/ValidationPanel.jsx` — bottom-left, collapsed summary pill (`2 warnings`) → expandable list; clicking an entry selects and reveals the node; green "Ready to run" when clean
- [x] Builder: replace the two inline `validateGraph()` `if`s and the single `serverError || lastError` string with this panel. **Save blocks on errors only; Run blocks on errors *or* warnings** — phase 1 blocks saving on a missing Start node, so an in-progress graph can't be parked
- [x] Move `NodeConfigPanel`'s local `exprError` into the shared validation state so the same problem isn't reported twice with two phrasings

### Toolbar & navigation guard

- [x] Undo / Redo / Duplicate buttons left of Save, disabled when unavailable, keyboard hints in tooltips
- [x] Save disabled while errors exist, reason in its tooltip
- [x] React Router blocker + `beforeunload` warning when `dirty` — losing an unsaved graph to a back-button press is the most expensive mistake the current UI allows

## Verification

- [x] Drag a node, `Cmd+Z` → previous position restored in **one** undo, not fifty
- [x] Delete three selected nodes, undo → all three plus every connecting edge return
- [x] Duplicate a two-node selection joined by an edge → two new nodes joined by a new edge, original untouched
- [x] Edit a duplicated handoff agent's `candidates` → original's `candidates` unchanged (deep-copy check)
- [x] Rename an edge label; it survives save + reload
- [x] A `true`/`false` condition edge cannot be renamed
- [x] Graph with an unconfigured tool node **saves** but refuses to **run**, naming that node
- [x] Clicking a validation entry selects and reveals the node
- [x] Navigating away dirty prompts; after save it doesn't
- [x] `Backspace` in the workflow-name field deletes a character, not a node
