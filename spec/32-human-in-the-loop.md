# Spec: Human-in-the-Loop Approvals & Resumable Runs

**Status:** Phase 3 — Tier 2
**Milestone:** M4
**Depends on:** `19-engine-parallelism-and-control.md`, `23-roles-and-invitations.md`, `24-socket-auth-and-namespaced-events.md`, `29-comments-mentions-notifications.md` (`notify()`), `30-workflow-versioning.md` (`Run.versionId`), `31-advanced-nodes.md` (node registry; long delays reuse this mechanism)
**Revises:** `06-execution-engine.md` (the "pausing/resuming a run" non-goal no longer applies), `19-engine-parallelism-and-control.md` (the run deadline counts active time only), `10-manual-run-trigger.md` (the 409 guard ignores `waiting` runs), `07-async-job-queue.md` (restart behaviour for runs)

## Summary

An **Approval** node pauses a run until a person decides. Assignees get a notification, an in-app Approvals inbox entry, and a signed approve/reject link. The decision routes the run down an `approved` or `rejected` branch. An optional timeout applies a default outcome.

The engineering core of this spec is that **a waiting run holds nothing in memory**: no queue slot, no engine loop, no timer beyond a lightweight re-armable one. The engine persists its state to the `Run` document as it goes. When nothing else is in flight it **parks** the run and exits. A decision **rehydrates** the run from MongoDB and continues. So a run can wait for days, across server restarts, and resume exactly where it stopped.

The same persistence gives the server a **startup reconciler**. After a crash, runs that were genuinely mid-flight are marked `failed` / `interrupted` instead of sitting at `running` forever, which is the problem `cancelRun`'s phase-2 fallback currently works around by hand.

## Goals

### 1. The Approval node

- Config:
  ```
  { label, title, description, assignees: { userIds: [], roles: [] },
    minApprovals: 1, timeout: { afterMs, outcome: 'approved' | 'rejected' } | null, showInput: true }
  ```
  - `title` and `description` are templates using `31`'s `resolveValue` scope. For example: `Refund {{input.amount}} to {{input.customer}}?`
  - `roles` are workspace roles such as `['admin']`.
- **Two source handles**, `approved` and `rejected`, which work like `condition`'s `true` and `false`. A rejection is a **routing outcome, not a failure**: it succeeds with `decision: 'rejected'` and prunes the `approved` edges.
- **Output**, passed downstream:
  ```
  { decision, decidedBy: { id, name } | 'timeout', comment, decidedAt, approvals: [...], input }
  ```
  The input is passed through, the same way `condition` does it, so downstream nodes still have the payload.
- **Kind:** orchestration (`31`). It never takes a queue slot.

### 2. Assignees and who can decide

- When the node starts waiting, the assignee spec is **resolved into a snapshot** of concrete user ids: the listed users plus current members holding any of the listed roles, deduplicated. If there are no assignees at all, the default is the workspace's owners and admins. The snapshot is stored on the node result, so a later role change doesn't silently add or remove approvers mid-wait.
- **Decision rule:** the first `reject` from any eligible approver rejects immediately. `approved` needs `minApprovals` distinct approvals (1 to the snapshot size, validated).
- **New permission rows** in `23`'s matrix:

  | Action | Owner | Admin | Editor | Viewer |
  |---|:-:|:-:|:-:|:-:|
  | `runs:approve`: decide an approval **you're assigned to** | ✅ | ✅ | ✅ | ✅ |
  | `runs:approve_any`: decide **any** approval in the workspace (override) | ✅ | ✅ | — | — |

  A viewer can be an approver. Approving isn't editing, and "a manager approves refunds but can't edit workflows" is a normal setup.
- At decision time, the approver must still be a member. Being removed from the workspace (`23`) revokes their pending approvals and invalidates their signed links.
- Self-approval (the user who triggered the run approving it) is allowed.

### 3. Parking: waiting runs hold nothing

**Engine state is persisted incrementally, for every run**, not only runs with approvals:

```
Run.engineState = { outputs: { [nodeId]: value }, pruned: [edgeKey], activeMs: number }
```

- `outputs` is the engine's *downstream-facing* output map. It's not the same as `nodeResults[].output`: a condition stores `{ taken }` as its result but passes its **input** downstream. That's why rehydration can't derive this map from `nodeResults`.
- Each node resolution already does one atomic `updateOne` for its result. It now also `$set`s `engineState.outputs.<nodeId>`, and `$addToSet`s any edges it pruned, in the **same update**. That's one write, not two, so the result and the state can't disagree.
- `35`'s retry-from-failed-node reuses exactly this map.

**Parking:**

- An approval node, or a long delay (`31`), becomes `waiting`: its node result gets `status: 'waiting'`, `waitingSince`, and optionally `resumeAt`.
- The engine keeps scheduling the other branches. When **nothing is in flight and at least one node is `waiting`**, the run parks. It sets `Run.status = 'waiting'` and `Run.waiting = [{ nodeId, reason: 'approval' | 'delay', since, resumeAt }]`, adds the elapsed active time to `engineState.activeMs`, and clears the deadline timer. It also emits `run:waiting`, removes itself from `activeRuns`, and **returns**.
- While other branches are still running, the run stays `running` and only the node shows `waiting`.

### 4. Resuming: rehydrate from MongoDB

`resumeRun(runId, { nodeId, resolve })` lives in `engine/resumeRun.js`. Decisions, delay timers and timeouts all go through it:

1. **Claim atomically:**
   ```
   Run.findOneAndUpdate({ _id, status: 'waiting', nodeResults: { $elemMatch: { nodeId, status: 'waiting' } } },
                        { $set: { status: 'running', 'nodeResults.$.status': 'running' }, $pull: { waiting: { nodeId } } })
   ```
   This conditional update is the **lock**. Two approvers clicking at once, or a timeout firing during a click, can't both resume. The loser gets `409 Already decided` along with the recorded decision.
2. **Load the graph from the run's pinned version** (`Run.versionId`, `30`), **never the current draft**. Otherwise, edits made while the run waited would change its graph halfway through.
3. **Rebuild engine state:**
   - `resolved` comes from the node results with a terminal status;
   - `outputs` and `pruned` come from `engineState`;
   - the deadline is restarted with the remaining budget `RUN_TIMEOUT_MS − activeMs`.
4. **Resolve the waiting node** (record the decision, set its output, prune the other handle's edges), then **re-enter the same readiness loop** `executeRun` uses. The loop body is factored into `drive(state)` so both entry points share it. `run:resumed` is emitted.

For runs with several waiting nodes (parallel approvals), resolving one continues its branch. The run parks again if the others are still waiting when that branch drains.

### 5. Timeouts and re-arming after a restart

- The optional approval timeout stores `resumeAt = waitingSince + afterMs` on the node. Long delays store `resumeAt` too.
- An in-process registry (`engine/waitTimers.js`, `Map<runId:nodeId, Timeout>`) arms one `setTimeout` per `resumeAt`. When it fires, it calls `resumeRun` with the default outcome (`decidedBy: 'timeout'`) or the delay's completion. A decision clears the timer.
- **On boot**, `bootstrapWaits()` finds every node with `status: 'waiting'` and a `resumeAt` and re-arms it. Anything already past fires immediately. This mirrors `bootstrapSchedules()` from `12`.
- **Waiting time doesn't count toward `RUN_TIMEOUT_MS`.** Only `activeMs` does. An approval without a timeout waits until someone decides or cancels.

### 6. Startup reconciler

This runs on boot after the `22` migration and before `bootstrapSchedules()` and `bootstrapWaits()`.

- Runs in `pending` or `running` can't be executing, since this process just started. So they become:
  - `status: 'failed'`, **`failReason: 'interrupted'`**, `finishedAt: now`;
  - `running` nodes → `failed`, with the log line `server restarted while this node was running`;
  - `pending` nodes → `skipped`.
- `waiting` runs are **left alone**. Parking only ever happens at a clean point with nothing in flight, so a waiting run is always resumable.
- A run that was `running` with one node `waiting` while another branch was mid-flight *is* interrupted. It hadn't parked yet. That's accepted and logged.
- Logged as `[reconcile] 2 interrupted runs marked failed, 3 waiting runs re-armed`.

**`failReason`** is a new field for *why* a run failed:
- `'nodes_failed'`: an unhandled node failure;
- `'timeout'`;
- `'interrupted'`;
- `null`.

The existing `cancelReason` keeps its phase-2 meaning. A timeout sets both `cancelReason: 'timeout'` and `failReason: 'timeout'` for backward compatibility, and new UI reads `failReason`.

### 7. The "already running" guard

`createAndStartRun`'s 409 guard checks `status ∈ ['pending', 'running']`, and **`waiting` is deliberately excluded**. Otherwise one refund awaiting approval would block every later webhook or event for that workflow for days, which defeats the "each payment failure gets its own approval" pattern. `33`'s concurrency cap doesn't count waiting runs either, since they hold no slots.

### 8. The signed approve/reject link

- **One link per assignee, per waiting node:** `/approve/:token`. The token is `base64url(payload).HMAC-SHA256(payload)`, where `payload = { runId, nodeId, userId, exp }` and the key comes from `APPROVAL_LINK_SECRET`. If that isn't set, the key is derived from `JWT_SECRET` with HKDF.
  - `exp` is the approval timeout, or 7 days when there's none.
- **`GET` never decides.** Opening the link shows a page with the title, description, the input (when `showInput` is on), and Approve / Reject buttons with an optional comment. Only the `POST` decides. That matters because email scanners and link unfurlers (Slack) follow GET links automatically.
- The link acts **without login**, since the signature proves who it was issued to. The decision is recorded as that user, with `via: 'link'`.
- A link is effectively single-use: once the node is decided, the page shows "Already approved by Alice at 14:02". A link is rejected if its user is no longer a member or an eligible approver.
- **Delivery:**
  - a `notify(userIds, { kind: 'approval_requested', runId, nodeId, title, link })` notification (`29`);
  - an Outbox message per assignee (`23`), containing the link;
  - `{{approval.link}}` is available to downstream templates, so a Slack node in a parallel branch can post it.

## Non-goals

- Multi-stage approval chains inside one node (use two Approval nodes).
- Forms: collecting structured input from the approver beyond a comment. That's a natural next step, but out of scope.
- Delegation or reassigning an approval once it's waiting (an admin can use `runs:approve_any` instead).
- Durable resume for **running** runs. Only parked runs survive a restart, and in-flight work is still lost (see `07`).
- Escalation reminders ("nudge after 1 h"). The timeout with a default outcome covers the demo.

## Data Model

**Workflow.nodes[].type** gains `approval`. Its source handles are `approved` and `rejected`.

**Run** changes:
```
status:       + 'waiting'
failReason:   'nodes_failed' | 'timeout' | 'interrupted' | null       (new)
waiting:      [{ nodeId, reason: 'approval' | 'delay', since, resumeAt }]   (new; empty unless waiting)
engineState:  { outputs: Mixed, pruned: [String], activeMs: Number }  (new; written for every run)
index { status: 1, 'waiting.resumeAt': 1 }
```

**Run.nodeResults[]**:
```
status:    + 'waiting'
waitingSince, resumeAt: Date | null
approval:  { assigneeIds: [ObjectId], minApprovals, title, description,
             approvals: [{ userId, decision, comment, at, via: 'app' | 'link' }],
             decision: 'approved' | 'rejected' | null, decidedBy: ObjectId | 'timeout' | null, decidedAt } | null
```

## API

| Method | Path | Auth | Body / Response |
|---|---|---|---|
| GET | `/api/approvals` | JWT + workspace | `?status=pending\|decided` → approvals assigned to the caller (or all of them with `runs:approve_any` and `?all=1`): `[{ runId, nodeId, workflowName, title, since, resumeAt, assignees }]` |
| POST | `/api/runs/:id/approvals/:nodeId` | `runs:approve` (assigned) or `runs:approve_any` | `{ decision: 'approve' \| 'reject', comment? }` → `200 { decision, status }`. `409` if already decided, `403` if not eligible. |
| GET | `/api/approval-links/:token` | **none** (signed) | `{ workspaceName, workflowName, title, description, input?, status, decidedBy? }`. `404` for a bad signature or an ineligible user, `410` when expired. |
| POST | `/api/approval-links/:token` | **none** (signed) | `{ decision, comment? }` → same as the in-app route |
| POST | `/api/runs/:id/cancel` | `workflow:run` | Now also handles `waiting`: marks it `cancelled`, the waiting and pending nodes `skipped`, clears its timers, cascades to child runs (`31`), and emits `run:cancelled`. |

Every decision calls `audit(req, 'approval.decided', { runId, nodeId }, { decision, via })` (`34`).

## Socket contract

| Event | Room | Payload |
|---|---|---|
| `node:update` | `run:<id>` | existing, with `status: 'waiting'`, `approval`, and `resumeAt` |
| `run:waiting` | `run:<id>` and `workspace:<id>` | `{ runId, workflowId, waiting: [{ nodeId, reason, resumeAt }] }` |
| `run:resumed` | `run:<id>` and `workspace:<id>` | `{ runId, nodeId, decision, decidedBy }` |

`workspace:<id>` gets the two run-level events so the Approvals inbox and run lists update live. Assignees are additionally notified on `user:<id>` through `29`.

## UI Behavior

- **Canvas:** the Approval node (✋) has green `approved` and red `rejected` handles. Its config panel covers the title and description templates, an assignee picker (members plus a role chip list), a min-approvals stepper, an optional timeout with a default outcome, and a "Show input to approver" toggle.
- **Run monitor:** a waiting run shows an amber `waiting` status badge (distinct from `running`) and a banner:
  > "Waiting for approval · Refund £40 to ACME? · assigned to Alice, Bob · 1 of 1 needed · auto-rejects in 3h 12m"

  Eligible viewers get **Approve** and **Reject** buttons with a comment box. Once decided, the node shows `✓ approved by Alice` or `✗ rejected by Bob`, and the taken edge is highlighted as in `16`. A parked delay shows "resumes at 09:00".
- **Approvals inbox** at `/w/:slug/approvals`, with a nav item and a pending-count badge fed by `workspace:<id>` events. It has Pending and Decided tabs. Rows show the workflow, the title, how long it's been waiting, and the time left, with inline Approve / Reject.
- **`/approve/:token`** (public route) is a focused card with the decision buttons, and never renders the app shell. Its states are: decided, expired, and invalid.
- **Run history and search** (`35`): `waiting` is a filterable status. Interrupted runs show `failed · interrupted` with a tooltip explaining the server restart.

## Edge Cases & Error Handling

- **Two approvers decide at once** → the conditional claim lets exactly one win. The other gets 409 plus the winning decision.
- **Timeout fires as someone approves** → the same lock applies, and whichever claims first is recorded.
- **Workflow edited or re-published while a run waits** → the run resumes on its pinned `versionId` graph, unchanged.
- **Workflow deleted while a run waits** → deleting a workflow cancels its waiting runs first (same cascade as cancel), so nothing resumes against a missing graph. Deleting a workspace (`22`) does the same.
- **Every assignee removed from the workspace** → the approval stays waiting. Owners and admins can still decide it with `runs:approve_any`, and the banner says "No eligible assignees left".
- **Server restarts during a resume** (claimed, before the loop re-parks or finishes) → the run is `running`, so the reconciler marks it `interrupted`. It's a narrow window, and it's accepted.
- **`minApprovals` greater than the snapshot size** → a validation warning at design time, and clamped to the snapshot size at run time, with a log line.
- **Loop iterations with approvals** (`31`) → each child run parks on its own. The parent loop node waits inline without holding a slot, and its in-memory wait is only lost on restart, in which case the parent is reconciled as interrupted while its waiting children survive.
- **`engineState.outputs` size** → it mirrors data already stored in `nodeResults`, so storage roughly doubles per run. That's acceptable at this scale. Individual stored outputs are capped at 1 MB (truncated with `truncated: true`), which keeps a run well under MongoDB's 16 MB document limit.

## Acceptance Criteria

- [ ] A run reaching an Approval node parks: `status: 'waiting'`, `queue:stats.active` is 0, and the run is absent from the engine's `activeRuns`.
- [ ] Approving routes the `approved` branch, rejecting routes `rejected`, and both end the run `success`.
- [ ] **Restart test:** park a run, restart the server, approve, and the run completes correctly using the pre-restart outputs of upstream nodes.
- [ ] An approval timeout fires after a restart (re-armed by `bootstrapWaits`) and applies the default outcome with `decidedBy: 'timeout'`.
- [ ] Two concurrent approve calls produce exactly one resume. The second gets 409.
- [ ] Editing and re-publishing the workflow while a run waits doesn't change the graph it resumes on.
- [ ] A run killed mid-execution (process exit) is `failed` / `interrupted` after reboot, with no node left `running` or `pending`.
- [ ] A waiting run doesn't block a new webhook run of the same workflow.
- [ ] A signed link: GET shows the page without deciding, POST decides as the right user, a tampered token 404s, a used link shows "already decided", and a removed member's link stops working.
- [ ] A viewer who's assigned can approve, and an unassigned editor can't. Owners and admins can override.
- [ ] Assignees receive an `approval_requested` notification and an Outbox message containing the link.
- [ ] Waiting time doesn't count toward `RUN_TIMEOUT_MS`.

`npm run check:engine` (extended) covers the engine criteria, including a spawn-kill-respawn restart test. `npm run check:approvals` covers the HTTP, link and permission criteria against a running server.
