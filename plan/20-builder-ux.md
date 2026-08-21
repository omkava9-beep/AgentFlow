# Plan: Builder UX Depth

**Spec:** [`spec/20-builder-ux.md`](../spec/20-builder-ux.md)
**Depends on:** `02-workflow-builder-canvas`, `03-node-configuration-panel`

Build before `16-agent-handoff` — arbitrary edge-label editing is a prerequisite for handoff candidate sync.

## Backend Tasks

None. Entirely client-side (server-side cycle validation lives in `19`).

## Frontend Tasks

### History (`store/workflowStore.js`)

- [ ] `past` / `future` snapshot stacks of `{ nodes, edges, name, selectedNodeId }`, `past` bounded to 50 entries
- [ ] `commit()` helper that pushes the current state onto `past` and clears `future`; call it from discrete actions (`addNode`, `connect`, delete, `updateNodeConfig`, `setName`)
- [ ] **Coalesce drag gestures** — React Flow fires `onNodesChange` per mouse-move, so snapshotting each one would fill the stack from a single drag. Commit on gesture boundaries (`onNodeDragStop`, selection change) rather than inside `onNodesChange`
- [ ] Debounce config-panel/name typing to one history entry per field per ~500ms idle
- [ ] `undo()` / `redo()` restoring graph *and* selection; seed `past` with the freshly-loaded graph so undo can't empty a canvas the user never emptied
- [ ] Undo after a save sets `dirty: true` again (undo is not a save rollback)

### Clipboard & deletion

- [ ] `clipboard: { nodes, edges } | null` in the store (in-memory only, no system clipboard)
- [ ] `copySelection()` / `paste(position?)` / `duplicateSelection()`
- [ ] Fresh ids via `nextId()`; **deep-copy `data.config`** — a shallow copy aliases arrays like `candidates`, so editing a clone would mutate the original
- [ ] Preserve edges internal to the pasted selection (remapped to new ids); drop edges leaving it
- [ ] Refuse to duplicate a `start` node, reusing `addNode`'s existing single-Start guard
- [ ] `deleteSelection()` with cascading edge cleanup

### Keyboard layer

- [ ] `hooks/useCanvasShortcuts.js` — `Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z`, `Ctrl+Y`, `Cmd/Ctrl+C`, `Cmd/Ctrl+V`, `Cmd/Ctrl+D`, `Delete`/`Backspace`
- [ ] Suppress every shortcut while focus is in an `input` / `textarea` / `contenteditable` — otherwise Backspace in the name field deletes a node

### Edge editing

- [ ] `selectedEdgeId` in the store; `onEdgeClick` selects
- [ ] Inline label editor for the selected edge; free text for normal edges
- [ ] Condition edges (`sourceHandle` `true`/`false`) keep bound labels and are **not** renamable — the engine matches on the handle, so a renamed label would be a lie
- [ ] For edges out of a handoff agent, offer that node's `candidates` as a dropdown so labels and candidates stay in sync by construction
- [ ] Custom edge styling for the selected edge (thicker + accent colour)

### Validation panel

- [ ] `utils/validateGraph.js` — pure `(nodes, edges, availableToolTypes) → { errors[], warnings[] }`, each entry `{ nodeId?, message }`
- [ ] Errors: no nodes; no `start` node; cycle present
- [ ] Warnings: tool node with no `toolType`; `toolType` not in `GET /api/tools`; unparseable condition expression; condition missing a `true` or `false` edge; handoff candidates ≠ outgoing edge labels; nodes unreachable from `start`; zero or multiple `end` nodes
- [ ] `components/ValidationPanel.jsx` — bottom-left, collapsed summary pill (`2 warnings`) → expandable list; clicking an entry selects and reveals the node; green "Ready to run" when clean
- [ ] Builder: replace the two inline `validateGraph()` `if`s and the single `serverError || lastError` string with this panel. **Save blocks on errors only; Run blocks on errors *or* warnings** — phase 1 blocks saving on a missing Start node, so an in-progress graph can't be parked
- [ ] Move `NodeConfigPanel`'s local `exprError` into the shared validation state so the same problem isn't reported twice with two phrasings

### Toolbar & navigation guard

- [ ] Undo / Redo / Duplicate buttons left of Save, disabled when unavailable, keyboard hints in tooltips
- [ ] Save disabled while errors exist, reason in its tooltip
- [ ] React Router blocker + `beforeunload` warning when `dirty` — losing an unsaved graph to a back-button press is the most expensive mistake the current UI allows

## Verification

- [ ] Drag a node, `Cmd+Z` → previous position restored in **one** undo, not fifty
- [ ] Delete three selected nodes, undo → all three plus every connecting edge return
- [ ] Duplicate a two-node selection joined by an edge → two new nodes joined by a new edge, original untouched
- [ ] Edit a duplicated handoff agent's `candidates` → original's `candidates` unchanged (deep-copy check)
- [ ] Rename an edge label; it survives save + reload
- [ ] A `true`/`false` condition edge cannot be renamed
- [ ] Graph with an unconfigured tool node **saves** but refuses to **run**, naming that node
- [ ] Clicking a validation entry selects and reveals the node
- [ ] Navigating away dirty prompts; after save it doesn't
- [ ] `Backspace` in the workflow-name field deletes a character, not a node
