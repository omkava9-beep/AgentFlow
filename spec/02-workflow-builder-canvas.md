# Spec: Workflow Builder Canvas

**Status:** MVP
**Milestone:** M1
**Depends on:** `01-auth.md`

> **Revised in phase 3:** New node types (transform, code, delay, loop, merge, sub-workflow, approval) and a grouped palette — see [`31`](31-advanced-nodes.md), [`32`](32-human-in-the-loop.md). The canvas is collaborative — see [`28`](28-realtime-collaboration.md).

## Summary

The visual canvas (React Flow) where a user builds a workflow by adding nodes (Agent, Tool, Condition, Start, End) and connecting them with edges. This is the primary authoring surface of the product.

## Goals

- Drag a node type from a palette onto the canvas.
- Connect nodes by dragging from one node's output handle to another's input handle.
- Select, move, and delete nodes and edges.
- A workflow always has exactly one Start node; End node(s) are optional but conventional.

## Non-goals

- Real-time multi-user collaborative editing (single editor at a time is fine).
- Undo/redo history beyond basic browser-level expectations (nice-to-have, not required).
- Auto-layout algorithms — manual placement is fine.

## Node Types (on the canvas)

| Type | Handles | Notes |
|---|---|---|
| Start | 1 output | Entry point; exactly one per workflow |
| Agent | 1 input, 1 output | Config lives in `03-node-configuration-panel.md` |
| Tool | 1 input, 1 output | Config lives in `03-node-configuration-panel.md` |
| Condition | 1 input, 2 outputs (`true`/`false`) | Branches based on an expression evaluated against the incoming node's output |
| End | 1 input | Terminal node; a workflow can have multiple |

## Data Shape (client-side, persisted via `04-workflow-persistence.md`)

```
nodes: [{ id, type, position: {x, y}, data: { label, config } }]
edges: [{ id, source, target, sourceHandle?, label? }]
```

`sourceHandle` distinguishes a Condition node's `true` vs `false` output edge.

## UI Behavior

- Left/side palette lists the 5 node types; click or drag to add to canvas.
- Clicking a node opens the Node Configuration Panel (`03`) for that node.
- Deleting a node also removes any edges connected to it.
- A "Save" button persists the current graph (see `04`); unsaved changes should be visually indicated (e.g. a dirty-state dot in the title bar).
- A "Run" button triggers `10-manual-run-trigger.md`.

## Edge Cases & Error Handling

- Prevent creating a cycle (this is a DAG) — reject an edge connection that would create one, with a toast/inline message.
- Prevent more than one Start node per workflow.
- Warn (non-blocking) if a node has no outgoing edge and isn't an End node — it's a dead end.
- Prevent saving/running a workflow with zero nodes or no Start node.

## Acceptance Criteria

- [ ] Can add each of the 5 node types to the canvas.
- [ ] Can connect two nodes with an edge, and a Condition node exposes two distinct outgoing edges.
- [ ] Deleting a node removes its edges.
- [ ] Attempting to create a cycle is blocked with feedback.
- [ ] Canvas state survives a page reload after saving (loads from `04`).
