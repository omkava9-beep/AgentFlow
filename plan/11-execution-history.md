# Plan: Execution History

**Spec:** [`spec/11-execution-history.md`](../spec/11-execution-history.md)
**Depends on:** `06-execution-engine`

## Backend Tasks

- [ ] `GET /api/workflows/:id/runs` — list runs for a workflow (`id`, `status`, `startedAt`, `finishedAt`, `durationMs`), newest first, paginated (e.g. `?page=1&limit=20`)
- [ ] `GET /api/runs/:id` — full `Run` doc including `nodeResults[]`
- [ ] Both behind `requireAuth`; scope by `run.ownerId === req.userId` (store `ownerId` directly on `Run` at creation time in `10` to avoid a join)

## Frontend Tasks

- [ ] `api/runs.js` — extend with `listForWorkflow(workflowId, page)`, `getById(runId)`
- [ ] "Runs" tab/section on the workflow page — paginated list of past runs, newest first, each row clickable
- [ ] `pages/RunHistoryDetail.jsx` (or reuse `RunMonitor`'s rendering component fed static data) — shows the same node-status overlay + log panel as the live monitor, but from a static `GET /api/runs/:id` response, no socket subscription
- [ ] If the opened run's status is still `pending`/`running`, redirect into the live `RunMonitor` (`09`) instead of showing a static (stale) view

## Verification

- [ ] Past runs for a workflow list with correct status/duration
- [ ] Opening a completed run's detail view shows accurate per-node outputs/logs
- [ ] Opening a still-in-progress run from History routes to the live monitor instead
- [ ] Pagination works correctly once a workflow has more than one page of runs
