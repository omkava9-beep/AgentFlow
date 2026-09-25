# Spec: Run Operations

**Status:** Phase 3 — Tier 2
**Milestone:** M4
**Depends on:** `22-workspaces-multitenancy.md`, `24-socket-auth-and-namespaced-events.md`, `30-workflow-versioning.md` (`Run.versionId`), `32-human-in-the-loop.md` (`Run.engineState`), `31-advanced-nodes.md` (child runs)
**Revises:** `11-execution-history.md` (search, filters, cursor pagination), `14-analytics-dashboard.md` (live refresh, per-workflow view), `18-rbac.md` (shared run detail view), `07-async-job-queue.md` (per-attempt hooks), `19-engine-parallelism-and-control.md` (the "resuming or retrying a run" non-goal is lifted, via a new run)

## Summary

The things people do with runs *after* starting them, in any real workflow product:

- **Re-run** exactly what ran before.
- **Retry from the failed node**, reusing everything that already succeeded.
- **Find** a run by status, trigger, version, date or workflow.
- **Share** a run's detail read-only.
- **Watch analytics update live**, including per workflow and per node.
- **See retries and backoff** as a timeline instead of guessing from log lines.

This closes the phase-2 report's §13.5, §13.6, §14.6 and §14.8.

## Goals

### 1. Re-run

- `POST /api/runs/:id/rerun` creates a new run with the **same input** and the **same executed graph**, by going through `createAndStartRun()`:
  - for a published run, the original `versionId`;
  - for a draft test run, the draft snapshot `30` records for it.

  **Never the current draft.** "Run that again" means the thing that ran, not whatever the canvas holds now.
- The new run records `rerunOf: <originalId>`. Its trigger is `manual`, with `triggeredBy` set to the caller. Whatever trigger the original had (webhook, event, schedule) shows as "Re-run of #a1b2 (webhook)".
- The `409` "already running" guard applies, as with any top-level run. Child runs (`31`) can't be re-run on their own: the action is offered on the root run.
- Permission: `workflow:run`.

### 2. Retry from the failed node

`POST /api/runs/:id/retry { fromNodeIds? }` creates a new run with `retryOf: <originalId>`. It **re-executes only the retry set and what depends on it**:

1. **Retry set `R`:** by default, every node that failed in the original (including `31`'s handled failures, if chosen explicitly). Callers may pass specific `fromNodeIds`.
2. **Re-executed:** `R ∪ descendants(R)`, following edges in the pinned graph.
3. **Reused:** every other node. It keeps its original result (`status`, `output`, `logs`), is marked **`reused: true`**, and is **not executed**. So an upstream `send-email` isn't sent twice, which is the whole point of retrying from a node instead of re-running.
4. **Engine state is seeded** from the original's `engineState` (`32`): `outputs` only for reused nodes, and `pruned` only for edges whose source is a reused node. Upstream condition and handoff decisions therefore stand, and the re-executed region starts fresh.
5. It **uses the original's graph** (`versionId` or draft snapshot), the same as re-run. Fixing a broken node means editing, publishing, and then starting a new run. Retry answers a different question: "this was transient, go again".

Constraints:
- Only offered when the original is terminal (`failed` or `cancelled`), or `success` with handled failures.
- The original stays untouched. Retries chain: a retry of a retry has its own `retryOf`.
- The run monitor labels it "Retry of #a1b2 from *Fetch invoices*".

A Loop node in `R` re-runs **all** its iterations in v1. Retrying only the failed iterations is noted as future work.

### 3. Run search and filters

A workspace-wide **Runs** page, and one query endpoint behind both it and the per-workflow history:

```
GET /api/runs?workflowId=&status=failed,cancelled&trigger=webhook,event&version=3
             &from=2026-09-01&to=2026-09-25&failReason=interrupted&q=a1b2&includeChildren=false
             &limit=25&cursor=<opaque>
→ { items: [...], nextCursor: string | null }
```

- **Cursor pagination on `(createdAt, _id)`, not `skip`.** New runs arrive constantly (cron, events, loops). With `skip`, every arrival shifts the pages, so you'd see a run twice or miss one. The cursor is an opaque base64 of the last item's `(createdAt, _id)`.
- `q` matches a run-id prefix (at least 4 hex characters).
- Child runs are hidden by default (`includeChildren=false`), since a 100-item loop would otherwise bury everything. `parentRunId=` lists one parent's children.
- **Items:**
  ```
  { id, workflowId, workflowName, status, failReason, trigger, versionNumber, isDraft,
    startedAt, finishedAt, durationMs, rerunOf, retryOf, parentRunId, childCount }
  ```
  `workflowName` comes from a `$lookup` limited to the returned page.
- **Indexes:**
  - `{ workspaceId: 1, createdAt: -1, _id: -1 }`
  - `{ workspaceId: 1, workflowId: 1, createdAt: -1 }`
  - `{ workspaceId: 1, status: 1, createdAt: -1 }`
- **Filters live in the URL query string**, so a filtered view is a shareable, bookmarkable link.
- `GET /api/workflows/:id/runs?page=` is kept for the phase-2 check scripts. It's implemented on top of the new query, and the client stops using it.

### 4. Shared run detail (closes `18`'s gap)

A share link (`18`) currently lists runs but can't open one. This adds `GET /api/shared/:shareToken/runs/:runId`, for root runs of *that* workflow only.

**The response is a whitelist, consistent with `18`'s reasoning:**

| Included (safe: describes execution) | Excluded (can carry data or identify people) |
|---|---|
| Run: `status`, `failReason`, `trigger`, `versionNumber`, `startedAt`, `finishedAt`, `durationMs` | `input` (webhook and event payloads) |
| Per node: `nodeId`, `status`, `startedAt`, `finishedAt`, `durationMs`, `attempts`, `cached`, `reused`, `handled` | `output`, `logs`, `engineState` |
| Routing: condition `taken`, `handoffTarget`, the taken approval handle | Error messages. A 4xx body or an exception can echo data, so a failed node shows "failed after N attempts". |
| `attemptsLog` timings and outcomes | `attemptsLog[].error`; approver names and comments; `triggeredBy`; `apiKeyId` |
| Loop `progress` counts | Child run ids and child details |

Routing *is* included, even though it's data-dependent, because highlighting the path taken is the point of looking at a run on the graph. The design is already visible through the link. Disabling workspace public sharing (`23`) kills these endpoints along with the link.

### 5. Live analytics, per workflow and per node

- **Live:** on every run status transition, the server emits **`run:status_changed`** to `workspace:<id>` with `{ runId, workflowId, status, trigger, createdAt, finishedAt }`.
  - The Analytics page listens, and **refetches the summary**, debounced to 2 s. The server doesn't push computed aggregates: the aggregation endpoint stays the single source of truth, and a burst of 50 loop children becomes one refetch rather than 50 recomputations.
  - The same event makes the Runs page and run history prepend new runs live (on the first page, when the run matches the active filters). It also updates status badges in place.
- **Per workflow:** `GET /api/analytics/summary?workflowId=` applies every existing aggregation to one workflow, and adds `nodeStats`:
  ```
  nodeStats: [{ nodeId, label, type, runs, successRate, avgDurationMs, p95DurationMs,
                avgAttempts, retryRate, cacheHitRate, handledFailures }]
  ```
  It's computed by unwinding `nodeResults` over that workflow's runs in the range. Labels come from the workflow's current graph, and nodes that have since been deleted show as `(deleted node)`. "Slowest nodes" and "flakiest nodes" become answerable.
- The existing `topToolTypes` groups by `config.toolType`. `26` changes tool config to `{ integration, action }`, so this aggregation moves with it (coordinate with `26`, and group by `integration.action`).

### 6. Retry and backoff timeline

- **Record every attempt.** `InProcessQueue` gains per-job `onAttemptStart` and `onAttemptEnd` hooks, alongside the existing `onRetry`. The engine uses them to append to `nodeResults[].attemptsLog`:
  ```
  [{ attempt, startedAt, finishedAt, durationMs, outcome: 'success' | 'failed', error, backoffMs }]
  ```
  `backoffMs` is the wait *before the next* attempt. The log is capped at 20 entries. Cache hits record a single `{ outcome: 'success', cached: true }` entry.
- **Stream it** as a new `node:attempt { runId, nodeId, entry }` event, rather than re-sending the growing array inside `node:update`. This is the same reasoning `09` used for `node:log`.
- **Show it:**
  - **Node detail, attempts timeline:** a horizontal track of attempt bars (red for failed, green for success) with the gaps labelled `waited 500ms`, `1s`, `2s`. Exponential backoff becomes something you can *see*.
  - **Run timeline (Gantt):** a tab beside the graph view with one row per node, bars from `startedAt` to `finishedAt`, and attempt segments inside the bars. Concurrent fan-out (`19`), queue waiting (the gap between ready and first attempt, which `33` makes visible per tenant), delays and approvals all read at a glance.

## Non-goals

- Bulk operations (retry every failed run matching a filter).
- Editing a run's input before re-running. Use a manual run with a payload once `31`'s Start input schema exists, or trigger it via the `24` API.
- Retrying individual loop iterations (see Goal 2).
- Full-text search over outputs or logs.
- Exporting runs (CSV or JSON).
- Pre-aggregated analytics or rollup collections. The query-time aggregation is fast enough at this scale.

## Data Model

**Run** adds:
```
rerunOf, retryOf: ObjectId | null;  retriedFromNodeIds: [String]
index { workspaceId: 1, createdAt: -1, _id: -1 }, { workspaceId: 1, workflowId: 1, createdAt: -1 },
      { workspaceId: 1, status: 1, createdAt: -1 }
```

**Run.nodeResults[]** adds:
```
reused: boolean (default false)
attemptsLog: [{ attempt, startedAt, finishedAt, durationMs, outcome, error, backoffMs, cached }]
```

## API

| Method | Path | Auth | Body / Response |
|---|---|---|---|
| POST | `/api/runs/:id/rerun` | `workflow:run` | → `202 { runId }`. `409` if a run is active, `400` for a child run. |
| POST | `/api/runs/:id/retry` | `workflow:run` | `{ fromNodeIds? }` → `202 { runId, reexecuted: [nodeId], reused: [nodeId] }`. `400` if the run isn't retryable or a node id is unknown. |
| GET | `/api/runs` | `workflow:read` | query as in Goal 3 → `{ items, nextCursor }` |
| GET | `/api/analytics/summary` | `workflow:read` | adds `?workflowId=`, and then includes `nodeStats` |
| GET | `/api/shared/:shareToken/runs/:runId` | **none** (share token) | the whitelisted run detail. `404` if the run isn't a root run of that workflow. |

## Socket contract

| Event | Room | Payload |
|---|---|---|
| `run:status_changed` | `workspace:<id>` | `{ runId, workflowId, status, trigger, createdAt, finishedAt, parentRunId }` |
| `node:attempt` | `run:<id>` | `{ runId, nodeId, entry }` |

`run:status_changed` is emitted from the same places that already emit `run:started`, `run:waiting` (`32`), `run:resumed` (`32`), `run:cancelled` and `run:completed`, so it can't drift from them.

## UI Behavior

- **Run monitor header:**
  - **Re-run** and **Retry from failed** buttons, enabled per Goals 1 and 2. Retry opens a small popover that lists failed nodes (all checked by default) and previews which nodes will re-execute and which will be reused.
  - Lineage chips: "Re-run of #…", "Retry of #…", "↑ parent run".
  - Reused nodes render with a dimmed ⟲ "reused" chip, so it's obvious they didn't run again.
- **Runs page** at `/w/:slug/runs` (new nav item):
  - Filter bar: workflow, status, trigger, version, and date range with presets (24 h / 7 d / 30 d / custom), plus a run-id search.
  - A results table with infinite scroll on the cursor, and live prepending.
  - The workflow's own Run History page is the same component with `workflowId` fixed.
- **Shared view:** the run list on `/shared/:token` becomes clickable → `/shared/:token/runs/:runId`, showing the read-only `RunGraphView` with statuses, the timeline tab, and the whitelisted node table. Nothing on it can start or change a run.
- **Analytics page:**
  - A workflow selector (all workflows, or one).
  - When one workflow is selected, a **Nodes** table (sortable by duration, retry rate or success rate) and a "slowest / flakiest" callout.
  - A small "live" indicator pulses when a refetch follows `run:status_changed`.
  - Run History links to "Analytics for this workflow".
- **Node detail panel:** the attempts timeline (Goal 6). The run-level **Timeline** tab sits beside **Graph**.

## Edge Cases & Error Handling

- **Retrying a run whose version was superseded** → it still runs on the original version, and the monitor says "on v3 (current is v5)".
- **Retrying when the original has no `engineState`** (a phase-2 run from before `32`) → retry is unavailable ("This run predates retry support"). Re-run still works.
- **A `fromNodeIds` node that was skipped in the original, downstream of the retry set** → fine, because it's in `descendants(R)` anyway. A node that was skipped by a condition *upstream* of `R` stays skipped, and the preview shows it.
- **Retrying a node whose upstream *reused* node is a side-effecting tool** → it isn't re-executed, by design. The preview makes that explicit.
- **Cursor from a different filter set** → the cursor encodes only position, so reusing it with new filters just continues from that point. The client resets the cursor whenever filters change.
- **An invalid date range or unknown enum value in a filter** → 400 naming the bad parameter, never an empty 200 that looks like "no runs".
- **A shared run detail for a child run, or another workflow's run, via a valid token** → 404.
- **An analytics refetch storm** during a large loop → the 2 s debounce means at most one refetch every 2 s per open page.
- **`attemptsLog` growth** → capped at 20 entries. When the cap is hit the last entry notes `…more attempts truncated`, and the `attempts` count stays accurate.

## Acceptance Criteria

- [ ] Re-running a webhook run executes with the same input on the same version, even after the draft has changed, and records `rerunOf`.
- [ ] Retrying `Start → A(send-email) → B(fails) → C` re-executes B and C only. A is `reused` and isn't re-sent (verified by the sandbox Outbox count).
- [ ] A retry preserves upstream condition routing: a branch pruned in the original stays skipped.
- [ ] The retry preview and the API's `reexecuted` / `reused` lists match what actually runs.
- [ ] `GET /api/runs` filters by every listed parameter. Cursor pages have no duplicates and no gaps while new runs are being created during pagination.
- [ ] Child runs are excluded unless asked for.
- [ ] The shared run detail contains none of the excluded fields (asserted by a key whitelist check), and 404s for child runs and foreign runs.
- [ ] With the Analytics page open, a finishing run updates the charts within about 3 s without navigation. A 50-child loop triggers at most a few refetches.
- [ ] Per-workflow analytics include `nodeStats` with correct success rate, retry rate and p95 for a seeded dataset.
- [ ] A node with `failureRate: 1.0`, `maxAttempts: 4` shows four red bars separated by roughly 500 ms, 1 s and 2 s gaps in the attempts timeline, and the same timings are in `attemptsLog`.
- [ ] The Gantt timeline shows parallel branches overlapping.

`npm run check:runs` (new, in `server/`) covers re-run, retry, search and the shared-detail whitelist against a running server. `npm run check:analytics` is extended for `workflowId` and `nodeStats`.
