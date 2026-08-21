# Plan: Workflow Persistence

**Spec:** [`spec/04-workflow-persistence.md`](../spec/04-workflow-persistence.md)
**Depends on:** `01-auth`, `02-workflow-builder-canvas`

## Backend Tasks

- [ ] `models/Workflow.js` — Mongoose schema (`ownerId`, `name`, `nodes[]`, `edges[]`, `createdAt`, `updatedAt`)
- [ ] `controllers/workflowController.js` — `list`, `create`, `getById`, `update`, `remove`
- [ ] `routes/workflows.js`:
  - [ ] `GET /api/workflows` (list, name+updatedAt only)
  - [ ] `POST /api/workflows` (create empty)
  - [ ] `GET /api/workflows/:id` (full doc)
  - [ ] `PUT /api/workflows/:id` (update nodes/edges/name)
  - [ ] `DELETE /api/workflows/:id`
- [ ] All routes behind `requireAuth`; ownership check (`workflow.ownerId === req.userId`) → `404` (not `403`) if mismatched
- [ ] Mount `workflows` routes in `app.js`

## Frontend Tasks

- [ ] `api/workflows.js` — `list()`, `create(name)`, `getById(id)`, `update(id, { name, nodes, edges })`, `remove(id)`
- [ ] `pages/Dashboard.jsx` — lists workflows as cards/rows (name, last updated), "New Workflow" button, per-item "Open"/"Delete"
- [ ] Delete confirmation dialog (destructive action)
- [ ] `Builder.jsx` — on mount, `getById` loads graph into `workflowStore`; "Save" button calls `update` with current graph, clears `dirty` flag on success
- [ ] Client-side validation gate before calling `update` (reuse `02`'s cycle/Start-node checks)

## Verification

- [ ] Create a workflow, add nodes, Save, reload the page → same graph reappears
- [ ] Dashboard shows only the current user's workflows
- [ ] Deleting a workflow removes it from the Dashboard; direct `GET` to its old id returns 404
- [ ] A workflow owned by user A returns 404 (not the data) when requested as user B
