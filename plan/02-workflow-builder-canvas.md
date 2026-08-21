# Plan: Workflow Builder Canvas

**Spec:** [`spec/02-workflow-builder-canvas.md`](../spec/02-workflow-builder-canvas.md)
**Depends on:** `01-auth`

## Frontend Tasks

- [ ] `pages/Builder.jsx` — hosts the React Flow canvas at `/workflows/:id`
- [ ] `store/workflowStore.js` (zustand) — holds current `nodes`, `edges`, `dirty` flag, selected node id
- [ ] `components/NodePalette.jsx` — lists 5 node types (Start, Agent, Tool, Condition, End); drag-and-drop or click-to-add onto canvas
- [ ] Custom React Flow node components for each type (`components/nodes/AgentNode.jsx`, `ToolNode.jsx`, `ConditionNode.jsx`, `StartNode.jsx`, `EndNode.jsx`) with correct handle counts (Condition gets 2 output handles labeled `true`/`false`)
- [ ] Wire React Flow `onConnect` to add edges to `workflowStore`; set `sourceHandle` for Condition outputs
- [ ] Wire node/edge deletion (`onNodesDelete`, `onEdgesDelete`) to remove from `workflowStore`, cascading edge removal when a node is deleted
- [ ] Cycle-prevention check in `onConnect` — reject and toast if the new edge would create a cycle (simple DFS from target back to source)
- [ ] Enforce single Start node — disable/hide "Start" in the palette once one exists on canvas
- [ ] Dead-end warning — non-blocking visual indicator (e.g. small icon) on a non-End node with no outgoing edge
- [ ] Builder toolbar: "Save" button (see `04`), "Run" button (see `10`), dirty-state indicator
- [ ] Validation before Save/Run: reject if zero nodes or no Start node, with inline messaging

## Backend Tasks

None net-new here — canvas state only becomes real data via `04-workflow-persistence`'s API. (No backend changes in this spec beyond what `04` already covers.)

## Verification

- [ ] Add one of each of the 5 node types to the canvas
- [ ] Connect two nodes; connect a Condition node and confirm both `true`/`false` edges are distinguishable
- [ ] Delete a node and confirm its edges are removed too
- [ ] Attempt to connect nodes in a way that creates a cycle — confirm it's blocked with feedback
- [ ] Attempt to add a second Start node — confirm it's prevented
- [ ] Reload the page after saving (via `04`) and confirm the same graph reloads
