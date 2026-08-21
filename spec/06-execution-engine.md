# Spec: Execution Engine

**Status:** MVP
**Milestone:** M2
**Depends on:** `04-workflow-persistence.md`, `05-agent-tool-providers.md`, `07-async-job-queue.md`

## Summary

The backend module that takes a saved workflow graph and a run request, walks the DAG, dispatches each node's work to the job queue, and produces a `Run` document with per-node results. This is the core of the whole project.

## Goals

- Given a `Workflow` doc, execute nodes in dependency order starting from the Start node.
- Support sequential chains, parallel branches (a node with multiple outgoing edges that aren't a Condition), and conditional branching (Condition node picks exactly one of its two outgoing edges based on evaluating its expression against the incoming value).
- Each node's execution is dispatched as a job on the async queue (`07`), not run inline — this is what makes concurrency/backpressure meaningful.
- Produce/update a `Run` document as execution proceeds (not just at the end) so `09-realtime-monitoring.md` has something to read from.

## Non-goals

- Loops/cycles in the graph (explicitly disallowed at the builder level, `02`).
- Distributed execution across multiple processes/machines — single Node process only.
- Pausing/resuming a run mid-execution.

## Data Model

**Run**
```
{
  _id,
  workflowId: ObjectId,
  ownerId: ObjectId,
  status: 'pending' | 'running' | 'success' | 'failed',
  startedAt: Date,
  finishedAt: Date | null,
  nodeResults: [{
    nodeId: string,
    status: 'pending' | 'running' | 'success' | 'failed' | 'skipped',
    output: any,
    logs: string[],
    startedAt: Date | null,
    finishedAt: Date | null,
    durationMs: number | null
  }]
}
```

A Condition node's untaken branch (and everything only reachable through it) is marked `skipped`, not left `pending` forever.

## Execution Algorithm

1. Topologically order nodes from the graph's edges.
2. Maintain a map of `nodeId → resolved output` as nodes complete.
3. A node becomes eligible to run once all of its incoming edges' source nodes have completed (and the edge wasn't a "not taken" Condition branch).
4. Enqueue eligible nodes onto the job queue (`07`); nodes with no dependency on each other run concurrently, bounded by the queue's concurrency limit.
5. Agent nodes call `AgentProvider.run(...)` (`05`); Tool nodes call the matching `ToolHandler.run(...)` (`05`); Condition nodes evaluate their expression against the incoming output, synchronously (no queue dispatch needed, but still recorded as a `nodeResults` entry).
6. After each node completes (or exhausts retries and fails, `07`), update the `Run` doc and emit a Socket.io event (`09`).
7. The Run is `success` when all reachable nodes complete successfully; `failed` if any reachable node exhausts retries and fails (downstream-only-reachable-through-it nodes become `skipped`).

## Edge Cases & Error Handling

- A node with unmet dependencies that will never complete (shouldn't happen given DAG validation in `02`, but guard anyway) — timeout the run after a sane ceiling (e.g. 2 minutes) and mark remaining `pending` nodes `failed` with a "stalled" log entry.
- Empty workflow (no Start node) — reject the run request at the API layer before invoking the engine (see `10`).

## Acceptance Criteria

- [ ] A 3-node sequential workflow executes in order with correct per-node outputs.
- [ ] A workflow with a parallel fan-out (two nodes depending on one parent) executes both concurrently.
- [ ] A Condition node's untaken branch nodes end up `skipped`, not `pending`/`running`.
- [ ] A node that exhausts retries marks the run `failed` and downstream-only nodes `skipped`.
