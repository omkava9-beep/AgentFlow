# Spec: Advanced Nodes

**Status:** Phase 3 — Tier 2
**Milestone:** M4
**Depends on:** `19-engine-parallelism-and-control.md`, `22-workspaces-multitenancy.md`, `30-workflow-versioning.md` (sub-workflows run the published version), `33-fair-queue-and-quotas.md` (fan-out counts toward the workspace cap)
**Revises:** `06-execution-engine.md` (node types, orchestration vs. work nodes), `19-engine-parallelism-and-control.md` (live-edge rule for error branches, readiness for first-wins merge), `02-workflow-builder-canvas.md` (palette), `20-builder-ux.md` (validation rules)

## Summary

Adds the node types production workflow tools rely on:

- **Transform:** reshape data.
- **Code:** a JavaScript escape hatch.
- **Delay:** wait for a while.
- **Loop / For-each:** run a body once per item of an array.
- **Merge:** explicit join semantics.
- **Sub-workflow:** call another workflow.
- **On-error branch:** handle a failure instead of failing the run.

All of them fit the readiness-driven engine from `19`.

The central design rule: **only leaf work takes a queue slot.** Agent, tool, integration and code nodes do work, so they go through the queue. Loop, sub-workflow, delay and merge only *orchestrate* other work, so they run inline in the engine and never hold a slot while waiting. Without this rule, a loop of sub-workflows deadlocks: the parent nodes fill every slot waiting for children that can never be scheduled.

## Goals

### 0. Engine structure: a node executor registry

`executeRun`'s `if (node.type === …)` chain is replaced by `server/src/engine/nodes/<type>.js` modules, all registered in one map:

```
{ type, kind: 'work' | 'orchestration', handles: { source: string[], error: boolean }, execute(ctx) }
```

- `kind: 'work'` executors are wrapped in `queue.enqueue(job, { maxAttempts, meta: { workspaceId } })`.
- `kind: 'orchestration'` executors are awaited directly by the engine.
- **Agent nodes are the one mixed case.** An agent with no tools is `work`: one model call is one queue job, as today. An agent **with tools** (`37`) is driven by `engine/agentLoop.js` as `orchestration`. Each model turn and each tool call is its own `work` job, so the agent never holds a slot while it waits on its own tool calls. The registry entry picks the kind per node from `config.tools`.

`ctx` exposes `input`, `node`, `run`, `pushLog`, `prune(handle)`, `startChildRun()`, `signal` (cancellation) and `workspaceId`. The readiness loop, fan-in, cancellation and deadline from `19` are unchanged. `start`, `end` and `condition` move into the registry as they are.

### 1. Transform

Reshapes the input into a new object using field mappings. No code involved.

- Config: `{ label, mode: 'replace' | 'merge', mappings: [{ key, value }] }`.
  - `key` may be a dotted path (`customer.name`), which builds nested output.
  - `value` is a template.
- Template scope: `input`, `run` (`id`, `trigger`, `input`), and `now` (an ISO timestamp).
- **Typed resolution** is added to `tools/template.js` as `resolveValue()`:
  - A value that is *exactly one* placeholder (`{{input.items}}`) resolves to the raw value (array, number or object).
  - Mixed text (`"Order {{input.id}}"`) resolves to a string, as it does today.
  - Without this, a Transform couldn't pass an array through to a Loop.
- `mode: 'merge'` shallow-merges the mappings over the input. `replace` outputs only the mapped keys.
- Unresolved references follow the existing `interpolate` rule: the value becomes empty and a log line is written. The node doesn't fail.
- **Kind:** orchestration. It's pure and cheap, like `condition`, so it doesn't take a queue slot.

### 2. Code

A JavaScript escape hatch, for logic that mappings can't express.

- Config: `{ label, source }`. `source` is a function body that receives `input` and must `return` a value.
- **Execution:** a fresh `worker_threads` Worker per invocation, created with:
  - `resourceLimits: { maxOldGenerationSizeMb: CODE_NODE_MEMORY_MB (64) }`, which is a real heap cap;
  - `env: {}`, so the worker's `process.env` doesn't expose `SECRETS_MASTER_KEY`, `JWT_SECRET` or API keys.

  Inside the worker, the source runs in a `node:vm` context. The context contains a `structuredClone` of `input`, a `console` whose `log`/`warn`/`error` are captured into the node's logs, and `JSON`, `Math` and `Date`. It has no `require`, `process`, `fetch` or `import`.
- **Limits:**
  - The worker is `terminate()`d after `CODE_NODE_TIMEOUT_MS` (default 1000, max 5000). Unlike `vm`'s own `timeout`, this also stops async code and runaway promises.
  - Output must be JSON-serialisable and at most 256 KB serialised.
  - A returned Promise is awaited within the same deadline.
- **Errors:** thrown errors, timeouts and oversized output are all `PermanentFailure`. Code is deterministic, so retrying the same input can't help. The only exception is when the node's `mockOverrides.maxAttempts` is set explicitly.
- **Kind:** work. It takes a queue slot, since it burns CPU.
- **This is not a security sandbox, and the spec says so plainly.** `node:vm` is documented by Node as not being a security mechanism. Anyone who can author a Code node can escape the context and run code with the server's full privileges: reading the filesystem (including `.env`), opening network connections, and reading other tenants' data. The worker's empty `env` and memory cap reduce accidents, not attacks. This is acceptable **only** because AgentFlow is a locally run, non-hosted deployment whose operator is also its user (see `PHASE_3_SCOPE.md` non-goals). The safeguards that follow from that:
  - A new permission row, **`code:author`** (owner and admin only; `23`). The server rejects any save or collaboration op (`28`) that adds a `code` node or changes its `source` without it. Editors can still *run* workflows that contain Code nodes.
  - `CODE_NODE_ENABLED` (default `true`). When it's `false`, code nodes fail with `PermanentFailure("Code nodes are disabled on this server")` and the palette hides them.
  - The config panel shows a warning: "Runs with server privileges. Only for trusted code."

### 3. Delay

- Config: `{ label, mode: 'duration' | 'until', durationMs, until }`.
  - `until` is a template that resolves to an ISO date.
  - The effective wait is capped at `DELAY_MAX_MS` (24 h).
- **Kind:** orchestration. It **never holds a queue slot**. The engine awaits `Promise.race([sleep(ms), ctx.signal.cancelled])`, so a cancel wakes the delay immediately instead of after the timer.
- **Short delays** (up to `DELAY_INLINE_MAX_MS`, 60 s) are an in-memory timer and count toward the run deadline.
- **Long delays** park the run using `32`'s waiting mechanism: the node becomes `waiting` with `resumeAt`, and the run becomes `waiting` once nothing else is in flight. A boot-time sweep re-arms the timer, so a 6-hour delay survives a restart. Waiting time doesn't count toward `RUN_TIMEOUT_MS` (`32`).
- Output: the input, passed through unchanged. Logs: `[delay] waited 5000ms` or `[delay] parked until 2026-10-01T09:00Z`.

### 4. Loop / For-each

Runs a body once per item of an array, with bounded parallelism, and collects the results in order.

- Config: `{ label, itemsPath, workflowId, concurrency, maxItems, continueOnError }`.
  - `itemsPath` is a template that must resolve to an array, for example `{{input.orders}}`.
  - `workflowId` is the body workflow.
  - `concurrency` defaults to 3 (range 1–10).
  - `maxItems` defaults to 100 (hard cap `LOOP_MAX_ITEMS`, 500).

**The body is a reference to a sub-workflow, not an inline subgraph.** An inline subgraph (a "loop container" on the canvas) would need:
- nested graph editing in React Flow (parent/child group nodes);
- body nodes that run N times, which breaks the flat one-result-per-node `nodeResults` model that the monitor, history, analytics and `35`'s retry all depend on;
- special cases in cycle validation;
- a nested entity model for `28`'s op sync and `30`'s diff.

A reference reuses exactly one execution path, the Sub-workflow node, N times. Each iteration becomes a real child `Run`, visible and inspectable in the monitor, and the body is versioned and published on its own. The cost is that the body has to live in a separate workflow. The config panel softens that with a **"Create body workflow"** action, which creates `<parent name> — loop body` with Start → End pre-wired, links it, and opens it in a new tab.

- **Execution:**
  1. Resolve the items. Not an array → `PermanentFailure`. More than `maxItems` → `PermanentFailure` telling you to raise the limit or pre-filter with a Transform.
  2. Dispatch child runs with at most `concurrency` in flight. Each child's Start node receives `{ item, index, total, parent: input }`.
  3. Children's work nodes enqueue with the **same workspace meta**, so they count toward the workspace cap under `33`'s fair queue. A 500-item loop can't starve other tenants.
- **Output**, always in index order regardless of completion order:
  ```
  { results: [{ index, status, output, runId }], succeeded, failed, total }
  ```
- **Failures:**
  - `continueOnError: false` (the default): the first failed iteration stops new dispatches, in-flight iterations finish, and the node fails.
  - `continueOnError: true`: every item runs, and the node succeeds whenever at least one iteration ran. Check `failed` downstream, or add an error branch.
- **Progress:** the node result carries `progress: { done, total }`, streamed via `node:update`, so the canvas shows `7 / 20`.
- **Kind:** orchestration.

### 5. Merge

`19`'s default fan-in already waits for every incoming edge to *resolve*, then runs with whichever inputs are live. Merge makes join semantics explicit and adds the two modes `19` can't express.

- Config: `{ label, mode: 'all' | 'any' | 'first', output: 'keyed' | 'array' | 'merged' }`.
- **Modes:**

  | Mode | Ready when | If a required input is missing |
  |---|---|---|
  | `any` (default) | Same as `19`: every incoming edge resolved. Runs with the live inputs. | Skipped only when no input is live |
  | `all` | Every incoming edge resolved | **Fails** (`"branch <label> did not complete"`) if any non-pruned incoming edge isn't live. This is a strict join. |
  | `first` | The **first** incoming edge whose source succeeds | Other branches keep running, since cooperative scheduling can't preempt them. Their results are ignored by this node, but the run still waits for them before finishing. |

  `first` is the one change to `19`'s readiness rule. `readyNodes()` asks the node's executor for `isReady(incoming, resolved)` instead of hard-coding "all resolved".
- **Output shapes:**
  - `keyed` is `19`'s `{ [sourceNodeId]: output }`.
  - `array` lists live outputs in edge order.
  - `merged` shallow-merges object outputs, with later edges winning.
- **Kind:** orchestration.

### 6. Sub-workflow

- Config: `{ label, workflowId, inputMapping: [{ key, value }] | null }`. Without a mapping, the parent's input is passed through as the child's Start output.
- **Same workspace only.** The picker lists this workspace's workflows. At run time the engine loads the child with `findInWorkspace` using the *parent run's* `workspaceId`. A foreign or deleted id → `PermanentFailure("Sub-workflow not found")`.
- **Always the published version** (`30`), even when the parent is a draft test run. An unpublished child → `PermanentFailure("<name> has no published version")`. Drafts are never executed by other workflows.
- **Linking:** the child `Run` records:
  - `parentRunId`, `parentNodeId` and `rootRunId`;
  - `depth` (parent + 1);
  - `iteration` (for loops);
  - `trigger: 'subworkflow'`, a new enum value.
- **`createAndStartRun`'s 409 "already running" guard doesn't apply to child runs.** It exists to stop duplicate top-level triggers, and a loop has to run many children of one body at once.
- **Depth guard:** `SUBWORKFLOW_MAX_DEPTH` (5). Exceeding it → `PermanentFailure("sub-workflow depth limit (5) reached")`. That also bounds recursion (A calls A), which is allowed but flagged by validation.
- **Deadline:** a child's deadline is the smaller of its own `RUN_TIMEOUT_MS` and the parent's remaining active time.
- **Cancellation cascades:** cancelling a parent cancels every non-terminal run whose `rootRunId` matches.
- **Output:** the child's End output. A failed child fails the node, with the child's failing node named in the log, and that failure is eligible for an error branch.
- **Kind:** orchestration.

### 7. On-error branch

Every node with `handles.error: true` gets a red **error** source handle. That's agent, tool (including integrations and MCP), code, sub-workflow and loop.

- The error edge is taken **only after the node has definitively failed**: every attempt exhausted, or a `PermanentFailure`. It's never taken per attempt, so retries from `07`/`19` still happen first.
- **Node has an outgoing edge with `sourceHandle: 'error'`:**
  - The node result is `failed` with `handled: true`.
  - Its normal outgoing edges are pruned, and its error edges are live.
  - The error edge carries `{ error: { message, attempts, nodeId, nodeLabel, type }, input }`.
  - The failure **doesn't fail the run**: `runFailed` is only set for unhandled failures.
- **Node succeeds:** its error edges are pruned, so the error path is `skipped`.
- **No error edge:** exactly the phase-2 behaviour.
- **`19`'s live-edge rule becomes:** an edge is live if it isn't pruned **and** either (source succeeded and it isn't an error handle) or (source failed with `handled` and it *is* the error handle).
- **Cancellation and timeout never route to error branches.** They're run-level decisions, not node failures.

### 8. Node types are plain entities

Each new type is an ordinary `{ id, type, position, data: { config } }` node. Cross-references (`workflowId`) point at *workflows*, never at other nodes, so `28`'s per-entity, per-field op sync and `30`'s diff need no special cases. The one exception is the `code:author` permission check on `code.source` edits, which is a server-side op filter rather than a data-model change.

## Non-goals

- Inline loop containers, `while` loops, or goto-style back-edges. The graph stays a DAG, and iteration only happens through Loop.
- A secure multi-tenant code sandbox (isolated-vm, containers, WASM). See Goal 2.
- npm packages or network access inside Code nodes.
- Cron-style recurring delays. That's what `12`'s schedules are for.
- Retrying only a loop's failed iterations. `35` retries the whole Loop node in v1.
- Merge by arbitrary expression ("wait until 2 of 3").

## Data Model

**Workflow.nodes[].type** enum becomes:
`start | end | agent | tool | condition | transform | code | delay | loop | merge | subworkflow`, plus `approval` from `32`.

**Workflow.edges[].sourceHandle** may be `'error'`. The server rejects it (400) from node types without an error handle.

**Node configs** (under `data.config`):
```
transform:   { label, mode, mappings: [{ key, value }] }
code:        { label, source, mockOverrides?: { maxAttempts } }
delay:       { label, mode, durationMs?, until? }
loop:        { label, itemsPath, workflowId, concurrency, maxItems, continueOnError }
merge:       { label, mode, output }
subworkflow: { label, workflowId, inputMapping }
```

**Run** adds:
```
parentRunId, parentNodeId, rootRunId: ObjectId | null;  depth: number (default 0);  iteration: number | null
trigger: + 'subworkflow'
index { rootRunId: 1 }, { parentRunId: 1 }
```

**Run.nodeResults[]** adds:
```
handled: boolean;  childRunIds: ObjectId[];  progress: { done, total } | null;  resumeAt: Date | null
```

**Env** (read in `config/env.js`): `CODE_NODE_ENABLED`, `CODE_NODE_TIMEOUT_MS`, `CODE_NODE_MEMORY_MB`, `DELAY_MAX_MS`, `DELAY_INLINE_MAX_MS`, `LOOP_MAX_ITEMS`, `SUBWORKFLOW_MAX_DEPTH`.

**Permissions** (`23`): a new row `code:author` (owner and admin).

## API

No new routes. The changes:

- `PUT /api/workflows/:id` (and `28`'s ops) validate node types, handle validity, and the `code:author` rule.
- `GET /api/runs/:id` includes `parentRunId`, `rootRunId`, `depth` and `childRunIds`.
- `GET /api/runs?parentRunId=` (from `35`) lists children.

## UI Behavior

- **Palette**, grouped into sections:
  - *Flow*: Start, End, Condition, Merge, Delay, Loop, Sub-workflow.
  - *Data*: Transform, Code.
  - *AI*: Agent.
  - *Integrations*: from `26`.

  Code is hidden when disabled, and shows a lock icon for roles without `code:author`.
- **Config panel:**
  - **Transform:** a key/value mapping table with add, remove and reorder, a mode toggle, and a live preview against the node's last run input when there is one.
  - **Code:** a monospace editor with line numbers and the privilege warning. It's read-only without `code:author`.
  - **Delay:** a duration input (with s / m / h units) or a date template.
  - **Loop:** an items template, a body workflow picker with the "Create body workflow" action, and concurrency, max items and continue-on-error controls.
  - **Merge:** mode and output selects, with a one-line explanation of each mode.
  - **Sub-workflow:** a workflow picker (this workspace, showing whether each is published), an optional input mapping table, and an "Open workflow" link.
- **Canvas:**
  - Error handles render red on the node's lower right. Error edges are drawn red and dashed.
  - The Loop node shows `done / total` while running.
  - Sub-workflow and Loop nodes show a "↗ child runs" link once running.
  - A Delay shows a countdown while waiting.
- **Run monitor (`RunGraphView`):**
  - Handled failures show amber with a "handled" chip, not red. Taken error edges animate like `16`'s taken handoff edges.
  - Loop and sub-workflow node details list their child runs (status, duration, and a link to the child's monitor). Child monitors show a breadcrumb back up to the root run.
- **Validation panel** (`validateGraph`), extended. Workflows and tools are passed in, the same way `tools` already is:
  - *error:* an error-handle edge from an unsupported type.
  - *warnings:*
    - Transform: no mappings, or duplicate or empty keys.
    - Code: empty source, or source that doesn't parse (checked with `new Function`, like conditions).
    - Delay: zero, or over 24 h.
    - Loop / Sub-workflow: no workflow selected, a missing or unpublished workflow, or a self-reference ("recursion — limited to depth 5").
    - Loop: concurrency outside 1–10.
    - Merge: fewer than two incoming edges.

## Edge Cases & Error Handling

- **Nested loops** (a loop body that contains a loop) → allowed. The depth guard bounds nesting. Parents never hold slots, so there's no deadlock whatever the concurrency.
- **Loop over an empty array** → succeeds immediately with `{ results: [], total: 0 }`. Downstream still runs.
- **A body workflow deleted mid-loop** → iterations already started finish. New dispatches fail with `PermanentFailure`, and that fails the node, subject to `continueOnError`.
- **Parent cancelled while children run** → a cascade cancel via `rootRunId`. Each child ends `cancelled`, and the parent's loop node becomes `skipped`, per `19`.
- **A child run's workflow belongs to another workspace** (a crafted id) → `findInWorkspace` 404s, and the node fails with "Sub-workflow not found". It never runs.
- **Code returns `undefined`** → output `null`, with the log line `[code] returned undefined`.
- **Code logs a huge string** → captured logs are capped at 100 lines of 1 KB each, then `[code] log truncated`.
- **Merge `first` where every branch fails** → skipped (no live input), consistent with `19`.
- **A node with both an error edge and `failureRate: 1.0`** (`17`) → it retries every attempt, then routes to the error branch. This makes a good demo of retry followed by fallback.
- **Error branch downstream of a handled failure also fails without its own error edge** → the run fails. Only the node that owns the error edge is "handled".
- **A long delay while the run has other in-flight branches** → the node waits (`waiting` + `resumeAt`) and the run stays `running` until those branches settle, then parks (`32`).

## Acceptance Criteria

- [ ] A Transform with `{{input.items}}` passes the array through intact (typed resolution), and mixed text resolves to a string.
- [ ] A Code node returning `input.a + input.b` works. `while(true){}` fails at the timeout. Allocating 1 GB fails at the memory cap. The worker's `process.env` is empty.
- [ ] An editor can't add or edit a Code node's source through the API or ops (403), but can run a workflow that contains one.
- [ ] A 5 s Delay holds no queue slot (`queue:stats.active` stays 0 during it), and cancelling mid-delay ends the run within 200 ms.
- [ ] A Loop over 20 items with `concurrency: 3` never has more than 3 child runs in flight, returns results in index order, and each iteration is an inspectable child run.
- [ ] A loop of loops with `QUEUE_CONCURRENCY=2` completes without deadlock.
- [ ] Merge `all` fails when one branch was skipped. `first` runs as soon as the fastest branch succeeds, and the run still finishes only after every branch settles.
- [ ] A Sub-workflow runs the child's **published** version, even after the child's draft has been edited since.
- [ ] Depth 6 fails with the depth-limit message, and a self-referencing sub-workflow stops there.
- [ ] Cancelling a parent cancels every descendant run.
- [ ] A tool with `failureRate: 1.0`, `maxAttempts: 3` and an error edge retries 3 times, then takes the error branch. The run ends `success` and the node shows "handled".
- [ ] The same tool without an error edge fails the run, exactly as in phase 2.
- [ ] Every new node type round-trips through save/load and through `28` ops without special-case code.

`npm run check:engine` (extended) covers these against a throwaway database, including a `QUEUE_CONCURRENCY=2` pass for the deadlock and concurrency-bound cases.
