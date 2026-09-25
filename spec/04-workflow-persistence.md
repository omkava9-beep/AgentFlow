# Spec: Workflow Persistence

**Status:** MVP
**Milestone:** M1
**Depends on:** `01-auth.md`, `02-workflow-builder-canvas.md`

> **Revised in phase 3:** workflows are scoped by `workspaceId`, not `ownerId` — see [`22`](22-workspaces-multitenancy.md). Saves go through the collaboration hub as ops instead of last-write-wins `PUT`, and version history exists — see [`28`](28-realtime-collaboration.md), [`30`](30-workflow-versioning.md).

## Summary

CRUD API and MongoDB schema for saving/loading workflow graphs (nodes + edges), and the Dashboard screen that lists a user's workflows.

## Goals

- Create, read, update, delete a workflow.
- List all workflows owned by the current user.
- A workflow's graph (nodes/edges) round-trips exactly through save → reload.

## Non-goals

- Version history / diffing between saves (a save simply overwrites).
- Collaborative/concurrent editing conflict resolution — last write wins.

## Data Model

**Workflow**
```
{
  _id,
  ownerId: ObjectId (ref User),
  name: string,
  nodes: [{ id, type, position: {x,y}, data: { label, config } }],
  edges: [{ id, source, target, sourceHandle?, label? }],
  createdAt: Date,
  updatedAt: Date
}
```

## API

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/workflows` | — | `[{ id, name, updatedAt }]` (list, no full graph) |
| POST | `/api/workflows` | `{ name }` | `{ id, name, nodes: [], edges: [] }` (creates empty workflow) |
| GET | `/api/workflows/:id` | — | full workflow doc |
| PUT | `/api/workflows/:id` | `{ name?, nodes, edges }` | updated workflow doc |
| DELETE | `/api/workflows/:id` | — | `204` |

All routes require auth (`01`) and verify `ownerId === req.userId`, returning 404 (not 403, to avoid leaking existence) for a workflow owned by someone else.

## UI Behavior

- Dashboard (`/dashboard`) lists the user's workflows as cards/rows (name, last updated), with "New Workflow" and per-item "Open" / "Delete" actions.
- Opening a workflow loads it into the Builder Canvas (`02`).
- Save button in the Builder calls `PUT /api/workflows/:id` with the current graph.
- Deleting a workflow asks for confirmation (destructive, irreversible).

## Edge Cases & Error Handling

- Saving a workflow with validation errors from `02`/`03` (cycles, missing Start node, invalid condition expressions) is rejected client-side before the API call.
- Deleting a workflow that has run history (`11`) — keep the Run documents (for audit/history) but they become orphaned/unreachable from the UI; not worth building cascade-delete or reference integrity for this scope.

## Acceptance Criteria

- [ ] Can create a new workflow, add nodes, save, reload the page, and see the same graph.
- [ ] Dashboard lists only the current user's workflows.
- [ ] Deleting a workflow removes it from the Dashboard and returns 404 on subsequent direct access.
