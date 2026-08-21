# Plan: Execution Engine

**Spec:** [`spec/06-execution-engine.md`](../spec/06-execution-engine.md)
**Depends on:** `04-workflow-persistence`, `05-agent-tool-providers`, `07-async-job-queue`

## Backend Tasks

- [ ] `models/Run.js` — Mongoose schema (`workflowId`, `ownerId`, `status`, `startedAt`, `finishedAt`, `nodeResults[]`)
- [ ] `engine/topologicalOrder.js` — builds dependency order from `nodes`/`edges`
- [ ] `engine/executeRun.js` — core orchestrator:
  - [ ] Track `nodeId → resolved output` map as nodes complete
  - [ ] Determine eligibility (all incoming, non-skipped-branch dependencies complete)
  - [ ] Dispatch eligible Agent/Tool nodes to the job queue (`07`); evaluate Condition nodes synchronously
  - [ ] Mark untaken Condition branches (and everything only reachable through them) `skipped`
  - [ ] Update the `Run` doc incrementally as each node completes (not just at the end)
  - [ ] Emit socket events per node transition (hook for `09`, stub/no-op until `09` is built)
  - [ ] Stall-guard: overall run timeout (e.g. 2 min) that fails remaining `pending` nodes with a "stalled" log if exceeded
  - [ ] Finalize `Run.status` (`success`/`failed`) once no nodes remain eligible/pending
- [ ] Wire Agent/Tool node dispatch to call `AgentProvider.run` / `ToolHandler.run` from `05` via the queue (`07`)
- [ ] Wire cache lookup (`08`) before dispatching Tool node jobs (integrate once `08` exists; stub pass-through until then)

## Frontend Tasks

None directly — this is a pure backend orchestration spec; frontend consumes its output via `09` (live) and `11` (history).

## Verification

- [ ] 3-node sequential workflow executes in correct order with correct per-node outputs
- [ ] A fan-out (two nodes depending on one parent) executes both concurrently (observe via logs/timestamps)
- [ ] A Condition node's untaken branch nodes end up `skipped`, not stuck `pending`
- [ ] A node that exhausts retries (force via `17`'s failure-rate override) marks the run `failed`, downstream-only nodes `skipped`
- [ ] `Run` doc updates incrementally during execution, not only at the very end (check via direct DB read mid-run)
