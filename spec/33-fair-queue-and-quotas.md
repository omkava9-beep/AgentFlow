# Spec: Fair Queue, Plans & Usage

**Status:** Phase 3 — Tier 2
**Milestone:** M4
**Depends on:** `07-async-job-queue.md`, `19-engine-parallelism-and-control.md`, `22-workspaces-multitenancy.md`, `23-roles-and-invitations.md`, `24-socket-auth-and-namespaced-events.md`
**Revises:** `07-async-job-queue.md` (FIFO → per-workspace round-robin), `24` (`queue:stats` gains `cap`), `23` (member limits, `workspace:billing` row)

## Summary

The in-process job queue is one FIFO array shared by every tenant. With several tenants, a single workspace that fans out 50 nodes (or loops over 50 items, `31`) fills the pool, and every other tenant's run waits behind it. This spec makes the queue **fair**: each workspace gets its own subqueue, and free slots are handed out round-robin, bounded by a per-workspace **concurrency cap** from the workspace's **plan**.

Plans are simulated. There are no payments, but they're also what drives two product limits: a **daily run quota** and a **member limit**. The same metering feeds a **Usage** page.

This is the phase-3 counterpart of phase 2's `19`. There, the goal was making concurrency real. Here, it's making concurrency fair.

## Goals

### 1. Round-robin across workspaces

`InProcessQueue` keeps `QUEUE_CONCURRENCY` as the **global pool size** and replaces the single `this.queue` array with:

```
subqueues: Map<workspaceId, { items: Job[], active: number }>
ring: workspaceId[]        // workspaces with queued work, in service order
cursor: number             // where the next dispatch round starts
```

`#fill()` loops while `activeCount < concurrency`. Each step walks the ring from `cursor`, takes the **first workspace that has queued items and is below its cap**, dispatches one job from the front of its subqueue, and advances `cursor` past it. When a whole pass of the ring finds no eligible workspace, it stops. Every other invariant from `07` and `19` stays the same: `stats`, `job:*` events, and per-job `maxAttempts` / `baseBackoffMs`.

The effect: with pool size 8, workspace A with 50 queued jobs and workspace B arriving with 3, **B's first job starts in the next free slot**, not after A's 50. Plain round-robin, with no weighting, is enough. Plan differentiation comes from the caps, and that's easier to explain in a demo than weighted fair queuing.

Jobs enqueued without `meta.workspaceId` (for example, `check:engine`, which drives the engine with no tenant) go into a `__system__` subqueue that has no cap. They still take their turn in the ring.

### 2. Per-workspace concurrency caps

- `enqueue(job, { maxAttempts, baseBackoffMs, meta: { workspaceId } })` is the signature `24` introduced. The queue asks an injected `capFor(workspaceId)` function for the cap, so **the queue never touches MongoDB**. `capFor` reads from a plan cache kept in memory, refreshed whenever a plan changes (Goal 4) and on boot.
- A workspace's `active` count never exceeds its cap, even when the pool has free slots. The idle slots go to other workspaces instead, or stay idle. That's the visible difference between plans.
- **A plan change takes effect on the next dispatch.** Jobs that are already running keep their slots and finish normally.

### 3. Retries and waiting don't hold a slot

- **Retry backoff already gives the slot back.** The current `#run()` calls `#release()` before `await delay(backoff)`, then `unshift`s the job to the front of the queue. That behaviour is kept, except the job now goes to the front of **its own workspace's subqueue**, and its workspace's `active` count drops for the length of the backoff. Otherwise a flaky node would hold its tenant's cap while doing nothing.
- **Any node that waits on other queued work must not sit in a slot while it waits.** Otherwise caps deadlock: at cap 1, a sub-workflow node holding the only slot waits forever for a child node that can never be dispatched. So:
  - **`31`'s sub-workflow and loop nodes** are orchestrated by the engine *outside* the queue. Only their leaf work (each child node, each loop iteration's body) is enqueued.
  - **`37`'s agent tool use** enqueues each model turn and each tool call as separate jobs. The loop between them runs outside any slot.
  - **`32`'s approval wait** never occupies a slot.

  `check:queue` includes a nested sub-workflow at cap 1 to prove this.
- **Nodes show that they're waiting.** Before enqueueing, the engine emits `node:update { waiting: true }`. The job's new `onStart` hook clears it and records `queuedMs` on the node result. The monitor shows "Waiting for a slot" in two variants: *plan limit* when the workspace is at its cap, and *server busy* when the pool itself is full.

### 4. Plans

Plans live in one module, `server/src/config/plans.js`, and nowhere else:

| Plan | Concurrency cap | Runs / day | Members (incl. pending invites) |
|---|---|---|---|
| `free` | 2 | 100 | 5 |
| `team` | 4 | 2,000 | 25 |
| `enterprise` | pool size (`QUEUE_CONCURRENCY`) | unlimited | unlimited |

- The default `QUEUE_CONCURRENCY` in `.env.example` rises from **4 to 8**. With 4, the Team cap would equal the whole pool, and fairness between two paying tenants couldn't be demonstrated.
- **Plan changes are simulated.** An owner picks a plan from the Usage page. A confirm dialog says "Plans are simulated — no payment is taken", and `Workspace.plan` is updated. No card fields, prices or checkout flow exist anywhere. Anything that looks like a payment form is out of scope.
- New matrix row: `workspace:billing` (change plan), granted to **owner only**.

### 5. Daily run quota

- This is a **product quota**, like "100 runs a day on Free". It's not API rate limiting, which `CLAUDE.md` still rules out: it counts runs per workspace per calendar day and never throttles requests.
- It's enforced once, in `createAndStartRun()`, **after** the existing `NOT_RUNNABLE` and `ALREADY_RUNNING` checks, so a request rejected for those reasons doesn't use up quota. The reservation is **atomic**: first the day's `UsageCounter` is upserted, then `updateOne({ _id, runs: { $lt: limit } }, { $inc: { runs: 1 } })` runs. If nothing matched, the quota is exhausted. Two triggers racing at `limit − 1` can't both get through.
- Exhausted → `{ ok: false, reason: 'quota-exceeded', resetAt }`, a new `SKIP_REASONS` entry. Each caller handles it:
  - HTTP callers (manual run, webhook, public API `24`) return **429** `{ error: 'Daily run limit reached for the Free plan', limit, resetAt }` with a `Retry-After` header.
  - Event fan-out (`24`) skips that workspace's subscribers and still returns `202`.
  - The scheduler logs the skip, and notifies the workflow's watchers (`29`) at most once per day.
- The day boundary is **UTC midnight**. `resetAt` is the next one. That's simple, and it's shown in the UI in the viewer's local time.
- **Exempt from the quota:** a run resuming from an Approval (`32`, since it's the same run), and child runs of a sub-workflow (`31`, which are part of the parent run). Their nodes still count as node executions. **Re-runs and retry-from-failed (`35`) are new runs, so they do count.**

### 6. Usage metering

- `UsageCounter` holds one document per workspace per UTC day.
- `runs` is incremented synchronously, because it gates the quota. Everything else goes into an in-process accumulator that's flushed every 5 s with a single `bulkWrite` of `$inc` operations. Up to 5 s of counts can be lost in a crash, which is acceptable for a usage chart, and the in-memory accumulator is a singleton, like the cache.
- **Counted:** runs; node executions; integration calls, split live vs sandbox (`26`); MCP tool calls (`37`); agent calls, split mock vs LLM; cache hits and misses; total queue wait (for "average wait").
- **Member limit:** `23`'s invite creation counts current members plus pending invites against the plan. Over the limit → `403 The Free plan allows 5 members`. Existing members are never removed on a downgrade. The limit only blocks new invites.

### 7. Usage page

Settings → **Usage & plan** (visible to all members, with plan change for owners only):

- A plan card (name, limits, and "Change plan" for owners).
- Meters for runs today vs quota (with the reset time), concurrency cap vs pool, and members vs limit.
- A 30-day chart of runs and node executions, reusing phase 2's chart components (`RunsOverTime`, `ChartCard`).
- A breakdown of integration calls (live vs sandbox), MCP calls, agent calls (mock vs LLM), cache hit rate and average queue wait.

## Non-goals

- Payments, invoices, trials, or proration.
- Request rate limiting or burst control (`CLAUDE.md`).
- Weighted or priority-based scheduling, or preemption of running jobs.
- Durable queue state. The queue stays in memory, and a restart loses queued jobs, as in phase 2 (`32` handles resuming *waiting* runs).
- Per-workflow quotas, and hard limits on node executions or integration calls. They're metered, not capped.

## Data Model

**Workspace**: `plan` (already declared in `22`).

**UsageCounter** (new)
```
{ _id, workspaceId, day: 'YYYY-MM-DD' (UTC),
  runs, nodeExecutions,
  integrationCalls: { live, sandbox }, mcpCalls, agentCalls: { mock, llm },
  cacheHits, cacheMisses, queueWaitMsTotal }
unique index { workspaceId: 1, day: 1 }
```

**Run nodeResults**: add `queuedMs: number`.

## API

| Method | Path | Permission | Response |
|---|---|---|---|
| GET | `/api/plans` | JWT | the plans table (limits only, no prices) |
| GET | `/api/workspaces/:id/usage` | `workflow:read` | `?days=30` → `{ plan, limits, today, series: [{ day, runs, nodeExecutions, ... }], live: { active, queued, cap } }` |
| PATCH | `/api/workspaces/:id/plan` | `workspace:billing` | `{ plan }` → workspace. Refreshes the in-memory plan cache. |

Changed: every run-starting route can now return **429** with `quota-exceeded`.

## Socket contract

| Event | Room | Payload |
|---|---|---|
| `queue:stats` | `workspace:<id>` | `{ workspaceId, active, queued, cap, concurrency, poolSaturated }` |
| `node:update` | `run:<id>` | adds `waiting: boolean`, `waitReason: 'cap' \| 'pool'`, `queuedMs` |

`poolSaturated` is a single boolean about the shared pool. It lets a tenant tell "you're at your plan limit" from "the server is busy" without revealing any other tenant's counts.

## UI Behavior

- **Queue indicator** (`QueueIndicator.jsx`) draws **`cap`** slots, not `concurrency` slots: "2 running · 5 queued · plan limit 2". When `poolSaturated` is true, a "Server busy" chip appears.
- **Run monitor:** a waiting node shows a dashed outline and "Waiting for a slot (plan limit)" or "(server busy)". The node detail shows `queuedMs` as "waited 1.2 s".
- **Run button** in the Builder: after a 429 it shows "Daily limit reached — resets at 01:00" and stays disabled until `resetAt`. Owners get an "Upgrade plan" link.
- **Invite dialog** (`23`): at the member limit, the Send button is disabled with an explanation.
- **Usage & plan** tab as described in Goal 7.

## Edge Cases & Error Handling

- **Workspace deleted with jobs queued** → `22`'s delete cancels the runs, and the engine stops dispatching their nodes. Queued jobs from cancelled runs still drain, as in `19` (the cancel check runs before dispatch). Its subqueue is dropped from the ring once it's empty.
- **Downgrade while a run is using 4 slots** → the running jobs finish, and the new cap of 2 applies to the next dispatch. The run just gets slower. Nothing is killed.
- **Downgrade with today's runs already above the new quota** → further runs are refused until `resetAt`. Runs that already exist are untouched.
- **Clock at UTC midnight while a run starts** → the reservation uses the server's UTC date at reservation time. A run can start at 23:59:59 on one day's counter and finish on the next. Runs are counted when they're created.
- **Plan cache out of step** (a plan edited directly in MongoDB) → the cache refreshes on every plan change through the API and on boot. Direct database edits need a restart. That's documented, not handled.
- **Metering flush fails** (MongoDB briefly down) → the counts stay in the accumulator and are retried on the next tick. They're never double-counted, because the accumulator is cleared only after a successful write.
- **Sub-minute cron on a Free workspace** → quota exhaustion is the natural limit. There's no extra scheduling rule.

## Acceptance Criteria

- [ ] With pool 8, workspace A enqueues 60 jobs and B then enqueues 4. B's first job starts within one dispatch of a slot freeing up, and all of B's jobs finish while A still has more than 40 queued.
- [ ] A Free workspace never has more than 2 active jobs, even when the pool has idle slots.
- [ ] A job in retry backoff holds neither a pool slot nor its workspace's cap (checked with a flaky node at cap 1 alongside a second node that completes during the backoff).
- [ ] A nested sub-workflow (`31`) and an agent with tool calls (`37`) both complete at cap 1, so no deadlock.
- [ ] A waiting node shows `waiting: true` with the correct `waitReason`, and records `queuedMs`.
- [ ] When the quota is exhausted, a manual run, webhook and public API call return 429 with `resetAt`. An event publish still returns 202 and skips that workspace. A cron tick logs the skip and notifies watchers once.
- [ ] Two concurrent triggers at `limit − 1` start exactly one run between them.
- [ ] A request rejected as not-runnable or already-running doesn't consume quota.
- [ ] Changing the plan changes the cap on the next dispatch and updates the Usage page and queue indicator live. Only owners can change it.
- [ ] Invites beyond the plan's member limit return 403.
- [ ] `queue:stats` exposes no other workspace's counts. `poolSaturated` is the only shared signal.
- [ ] `check:engine`, which runs without a workspace, still passes (the `__system__` subqueue).

`npm run check:queue` (in `server/`, no server needed) drives `InProcessQueue` directly for the fairness, cap, backoff and deadlock criteria. It also seeds today's `UsageCounter` to `limit − 1` in a throwaway database for the quota race.
