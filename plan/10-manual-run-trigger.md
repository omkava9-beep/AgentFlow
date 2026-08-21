# Plan: Manual Run Trigger

**Spec:** [`spec/10-manual-run-trigger.md`](../spec/10-manual-run-trigger.md)
**Depends on:** `04-workflow-persistence`, `06-execution-engine`

## Backend Tasks

- [ ] `controllers/runController.js` — `createRun(workflowId)`:
  - [ ] Validate workflow has a Start node (defense in depth even though `02` blocks this client-side) → `400` if invalid
  - [ ] Create `Run` doc with `status: 'pending'`
  - [ ] Kick off `engine.executeRun(run, workflow)` without awaiting completion
  - [ ] Respond `202 { runId, status: 'pending' }` immediately
- [ ] `POST /api/workflows/:id/runs` route, behind `requireAuth` + ownership check
- [ ] Guard against duplicate concurrent runs of the same workflow (check for an existing `pending`/`running` Run for that `workflowId` before creating a new one; reject with `409` if found)

## Frontend Tasks

- [ ] `api/runs.js` — `createRun(workflowId)`
- [ ] Builder toolbar "Run" button: disabled while a run for this workflow is already in progress (track via a quick "is there an active run" check, or just disable immediately after click until navigation)
- [ ] Prompt "save first" if `workflowStore.dirty` is true, before allowing Run
- [ ] On success, navigate to `RunMonitor` (`09`) for the new `runId`
- [ ] Loading state on the button during the API call

## Verification

- [ ] Clicking Run on a valid, saved workflow creates a run and navigates to its live monitor
- [ ] Clicking Run again while one is in progress is prevented (client-side disable + server-side 409 as backstop)
- [ ] Running an unsaved (dirty) workflow prompts to save first
- [ ] Running a workflow with no Start node is rejected with a clear 400
