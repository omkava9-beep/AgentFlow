# Spec: Workflow Versioning — Draft & Publish

**Status:** Phase 3 — Tier 1
**Milestone:** M4
**Depends on:** `20-builder-ux.md` (validation), `22-workspaces-multitenancy.md`, `23-roles-and-invitations.md`, `28-realtime-collaboration.md`
**Revises:** `04-workflow-persistence.md` (the "no version history" non-goal no longer applies), `10-manual-run-trigger.md` (Run becomes a draft test run), `11-execution-history.md` (runs show their version), `12`/`13`/`21`/`24` (triggers run the published version), `15-workflow-templates.md` (new workflows start unpublished), `18-rbac.md` (share links show the published version)

## Summary

With `28` there's no "save" any more: the canvas is a live, autosaved draft that several people edit at once. That's fine for the editors, but dangerous for everything that runs on its own. A cron tick at 09:00 shouldn't execute whatever half-finished graph Bob happened to have on screen at 08:59.

This spec separates the **draft** (what's on the canvas) from **published versions** (immutable, numbered snapshots). Triggers always run the published version. The Builder's Run button runs the draft as a clearly labelled **test run**. There's a version list, a visual diff on the canvas, restore-to-draft, and one-click rollback. Every run records exactly which graph it executed, which also fixes a latent bug: the run monitor currently redraws a finished run against the workflow's *current* graph (`RunMonitor` → `getWorkflow`), so editing a workflow rewrites how its old runs look.

## Goals

### 1. Versions are immutable snapshots

- **Publishing** creates `WorkflowVersion n+1`: a deep copy of the draft's `name`, `nodes` and `edges`, taken straight from the hub's in-memory document (`28`) at a specific `sourceSeq`, along with an optional message and the publisher.
- Version numbers are per workflow, start at 1, and never get reused. They're allocated atomically (`findOneAndUpdate` with `$inc: { versionCounter: 1 }`).
- A version is never edited or deleted. Versions are removed only when their workflow is deleted (added to `22`'s cascade).
- `Workflow.publishedVersionId` / `publishedVersion` point at the version the triggers run. The pointer only ever moves forward. **Rolling back** to v2 creates v5 with v2's content (Goal 6), so history stays linear and "what was live when" can always be answered.

### 2. What runs what

`createAndStartRun(workflow, { trigger, input, source })` resolves the graph once and passes it to `executeRun`:

| Started by | Runs | `Run` records |
|---|---|---|
| Builder **Test run** button | the **draft**, after flushing the hub | `isDraft: true`, `versionId: null`, `graph: {nodes, edges}` snapshot |
| Builder **Run published** (split-button option) | the published version | `isDraft: false`, `versionId`, `versionNumber` |
| Schedule (`12`), webhook (`13`), event (`21`/`24`), API (`24`), integration trigger (`27`) | the **published** version, always | `isDraft: false`, `versionId`, `versionNumber` |
| Sub-workflow node (`31`) | the child workflow's **published** version | same, on the child run |
| Re-run / retry-from-failed (`35`) | **the original run's graph** (its `versionId`, or its `graph` snapshot for draft runs), never the current draft | same as the original run |

- **Never published** → every automatic trigger skips with the reason `not-published`: the scheduler logs `skipped: workflow has no published version`, and webhook, API and event requests get `409 { error: 'Workflow has no published version' }`. The event fan-out response gains `skipped: [{ workflowId, reason }]` next to `triggered` (an additive change to `21`'s contract).
- **Concurrent-run guard:** the existing one-active-run-per-workflow check (`createAndStartRun`) becomes one active run **per workflow per kind**, where the kinds are draft and published. An editor's test run must not block the 09:00 production run, and the reverse.
- **Every run carries its graph:** `GET /api/runs/:id` returns `graph`, read from the version (published runs) or from the stored snapshot (draft runs). `RunMonitor` and `RunGraphView` render **that**, not the live workflow. Runs from before this spec have neither, so they fall back to the current workflow with a "pre-versioning run — graph may have changed" note.

### 3. Publish requires a valid graph

- The server re-runs graph validation. `client/src/utils/validateGraph.js` is ported into `server/src/engine/validateGraph.js`, with the tool list from the server-side registry. `check:logic` runs one shared fixture set against **both** copies so they can't drift.
- **Errors** (no Start node, no nodes, a cycle) → `422 { errors, warnings }`. Publishing is refused.
- **Warnings** (unconfigured tool, unmatched handoff candidates, unreachable nodes, …) → publishing needs `acknowledgeWarnings: true` and records the warnings on the version. The UI shows "Published with 2 warnings". Warnings still block the *test run* button per `20`. The reasoning: publishing is a deliberate act by someone with `workflow:publish`, while the test-run block exists to stop accidental runs.
- **Nothing changed** → if the draft's content hash equals the published version's, the server returns `409 Nothing to publish` (rollback is the exception; see Goal 6).

### 4. "Unpublished changes"

- `Workflow.hasUnpublishedChanges` is `contentHash(draft) !== publishedContentHash`. The hash is a stable-stringified SHA-1 of **nodes (id, type, data) and edges**. It **excludes node positions and the workflow name**, because neither changes what a run does. Moving a node around isn't "a change you need to publish". Publishing still snapshots both.
- The hub recomputes the hash after each applied op (graphs have tens of nodes, so this costs microseconds). When the flag flips, it broadcasts `version:draft_state { hasUnpublishedChanges }` to `workflow:<id>` and `workspace:<id>`, so the dashboard's badge also updates live.

### 5. Version list, view and diff

- **Version list:** number, message, publisher, date, warning count, node count, and a "Live" badge on the published one.
- **View** opens a read-only canvas of that version (the same read-only mode used for viewers in `23`).
- **Diff:** compare any two versions, or a version against the current draft. It's computed on the server, keyed by node and edge **id**, since ids stay the same across edits in `28`:
  ```
  { nodes: { added: [id], removed: [id], changed: [{ id, paths: [['systemPrompt'], ['toolConfig','to']] }], moved: [id] },
    edges: { added: [id], removed: [id], changed: [{ id, fields: ['label'] }] },
    nameChanged: boolean }
  ```
  Config is compared path by path, deeply. Arrays are compared as whole values, matching `28`'s op model. Position-only differences go in `moved`, not `changed`.
- **Diff mode on the canvas** renders both graphs together, read-only:
  - added nodes and edges are outlined green with a "+" chip;
  - removed ones are red, dashed, and ghosted at their old position;
  - changed ones are amber, and clicking one opens a side panel with before and after values for each field;
  - moves are hidden behind a "Show layout changes" toggle.

  A legend and a version picker (A ↔ B) sit at the top.

### 6. Restore and roll back, two different verbs

- **Restore to draft** (`workflow:edit`): replaces the **draft** with version *n*'s content through `hub.replace()` (`28`). Collaborators get `collab:snapshot { reason: 'restored', version }` and a toast saying "Alice restored the draft to v2", and their undo history is cleared (`28` Goal 6). **Nothing is published.** Triggers keep running the current live version until someone publishes.
- **Roll back** (`workflow:publish`): publishes version *n*'s content **as a new version** (`rolledBackFrom: n`). The draft is untouched, so `hasUnpublishedChanges` may become `true`. This is the "production is broken, put v2 back now" button, and it bypasses the "nothing to publish" check.

### 7. Side effects of publishing

- `audit(req, 'workflow.published', { workflowId, version, rolledBackFrom? })` (`34`). Restore logs `workflow.draft_restored`.
- `notify(watcherIds − publisher, { type: 'workflow.published', workflowId, version, by })` (`29`). Watchers are defined in `29`.
- Socket: `version:published { workflowId, version, by, message }` to `workflow:<id>` and `workspace:<id>`.
- **Runs already executing aren't affected.** Each one holds its own graph snapshot, so a run that started on v3 finishes on v3.

### 8. Migration

`server/src/scripts/migrateVersions.js` runs on boot, after `22`'s workspace migration and before the scheduler starts, and is also available as `npm run migrate:versions`. For every workflow with at least one node and no `publishedVersionId`, it publishes **v1** from the current graph, with the message `Initial version (migrated)` and `publishedBy = createdBy`. Every phase-2 schedule, webhook and event subscription keeps working without anyone having to click Publish. Empty workflows are skipped. It's safe to run again.

## Non-goals

- Branches, merging, or several drafts per workflow. There's one shared draft, edited collaboratively.
- Review or approval before publishing ("request publish"). The `workflow:publish` permission is the only gate.
- Staging or production environments, or different versions per trigger.
- **Versioning trigger settings.** Schedule, webhook, event subscription and share settings are operational settings on the workflow, not part of the graph. Changing a cron expression takes effect immediately without a publish, as it does today.
- An "unpublish" action. Disabling the triggers is the kill switch that already exists.
- Pruning or retention limits on versions. Snapshots are small.

## Data Model

**WorkflowVersion** (new)
```
{ _id, workflowId, workspaceId, version: number, name, nodes, edges,
  message: string, publishedBy: ObjectId<User>, sourceSeq: number, contentHash: string,
  warnings: [{ code, message, nodeId? }], rolledBackFrom: number | null, createdAt }
unique index { workflowId: 1, version: 1 };  index { workspaceId: 1 }
```

**Workflow**: adds `versionCounter: number` (default 0), `publishedVersionId: ObjectId | null`, `publishedVersion: number | null`, `publishedContentHash: string | null`, `publishedAt`, `publishedBy`, `hasUnpublishedChanges: boolean`.

**Run**: adds `isDraft: boolean` (default `false`), `versionId: ObjectId | null`, `versionNumber: number | null`, `graph: { nodes, edges } | null` (set for draft runs only).

**Permission matrix (`23`)**: adds the row **`workflow:publish`: Owner ✅, Admin ✅, Editor ✅, Viewer —**. Restore uses the existing `workflow:edit`. Viewing and diffing use `workflow:read`.

## API

| Method | Path | Permission | Body / Response |
|---|---|---|---|
| POST | `/api/workflows/:id/publish` | `workflow:publish` | `{ message?, acknowledgeWarnings? }` → `201 { version }`. `422 { errors, warnings }` for errors, or for warnings without the acknowledgement. `409` if nothing changed. |
| GET | `/api/workflows/:id/versions` | `workflow:read` | `?page=` → `[{ id, version, message, publishedBy: { id, name }, createdAt, warningsCount, nodeCount, isLive, rolledBackFrom }]` |
| GET | `/api/workflows/:id/versions/:version` | `workflow:read` | full snapshot |
| GET | `/api/workflows/:id/diff` | `workflow:read` | `?from=<version>&to=<version\|draft>` → diff object (Goal 5) plus both graphs |
| POST | `/api/workflows/:id/versions/:version/restore` | `workflow:edit` | → `200 { draftSeq }`. Broadcasts `collab:snapshot`. |
| POST | `/api/workflows/:id/versions/:version/rollback` | `workflow:publish` | `{ message? }` → `201 { version }` |
| POST | `/api/workflows/:id/runs` | `workflow:run` | now takes `{ source: 'draft' \| 'published' }`, default `'draft'` from the Builder |
| GET | `/api/runs/:id` | `workflow:read` | now includes `isDraft`, `versionNumber`, `graph` |
| GET | `/api/workflows`, `/api/workflows/:id` | — | now include `publishedVersion`, `hasUnpublishedChanges` |
| GET | `/api/shared/:shareToken` | none | now returns the **published** version's graph. `404`-style "not published yet" if there's none. |

All paths are workspace-scoped per `22`.

## Socket contract

| Event | Direction | Payload |
|---|---|---|
| `version:published` | server → `workflow:<id>`, `workspace:<id>` | `{ workflowId, version, by, message, rolledBackFrom? }` |
| `version:draft_state` | server → `workflow:<id>`, `workspace:<id>` | `{ workflowId, hasUnpublishedChanges }` |
| `collab:snapshot` | server → `workflow:<id>` | with `reason: 'restored', version` (defined in `28`) |

## UI Behavior

- **Builder header:** a status chip reads either "Live: v3" or "Live: v3 · unpublished changes" (amber), or "Never published" (grey). **Publish** is the primary button, in the spot the removed Save button used to occupy.
- **Publish dialog:**
  - it opens with the **draft ↔ live** diff summary ("+2 nodes, 1 changed, 1 edge removed") and a "View diff" link;
  - it lists warnings, with an "I understand" checkbox required when there are any;
  - there's an optional message field;
  - errors disable Publish and say why.
- **Run split button:** "▶ Test run (draft)" is the default, and "Run published v3" is in the dropdown. The test-run button follows `20`/`28`'s blocking rules. "Run published" only needs a published version to exist.
- **Versions drawer** (right side, opened from the header): the version list, with actions on each entry: *View*, *Compare with draft*, *Compare with…*, *Restore to draft*, *Roll back to this* (behind a confirm dialog saying "This publishes v2's graph as v6. Triggers switch immediately.").
- **Diff mode:** described in Goal 5. Leaving diff mode returns to the live draft.
- **Dashboard cards:** a version badge ("v3") with an amber dot when there are unpublished changes. It updates live through `version:draft_state`.
- **Run history and monitor:** a badge reading "v3" or "Draft" beside the trigger badge. The monitor header says "Ran v3" or "Test run on draft", and the canvas renders the run's own graph.
- **Viewers** can open the drawer, view versions and diffs, and nothing else.

## Edge Cases & Error Handling

- **Publishing while collaborators are typing:** the snapshot is taken synchronously from the hub at a known `sourceSeq`, so ops that arrive afterwards belong to the draft only. The dialog shows the seq it published, and the "unpublished changes" chip flips back on if edits landed meanwhile.
- **Two people publish at the same moment:** the atomic counter gives v4 and v5. If the second one's content matches v4, it gets `409 Nothing to publish` instead of an empty duplicate.
- **Restore while others have pending ops:** their pending ops are rebased onto the restored snapshot (`28`). Ops aimed at nodes that no longer exist are rejected with `not_found` toasts.
- **A trigger fires mid-publish:** it reads `publishedVersionId` at that moment and runs either the old version or the new one, never a mix of the two. Each run holds a single version snapshot.
- **A published version references a connection that's been deleted since** (`25`) or a tool that's been removed: the run fails that node with the existing `Unknown tool type`, or with `25`'s missing-connection permanent failure. The version list shows a warning icon on the live version, computed on read by re-validating it.
- **A template used to create a workflow** (`15`) → the new workflow has no published version, and its triggers skip with `not-published` until someone publishes.
- **The share link on a never-published workflow** → the shared page says "This workflow hasn't been published yet". Unfinished drafts never leak through a public link.
- **Diffing against a version from before a node type existed** (for example a `31` loop node added later) → the diff is keyed by id and type-agnostic, so it works unchanged. Unknown types render with the generic node.
- **Deleting a workflow** removes its versions. Runs of it are orphaned, as `04` already specifies.

## Acceptance Criteria

- [ ] After the migration, every non-empty phase-2 workflow is at v1, and its schedules, webhooks and event subscriptions still start runs.
- [ ] Editing the draft doesn't change what a scheduled, webhook, event or API run executes. Those runs execute the published graph, verified by node config values in the run output.
- [ ] Test runs execute the current draft, including edits made seconds earlier that haven't been flushed yet (the hub flushes first).
- [ ] A test run and a published run of the same workflow can be active at the same time. Two published runs of one workflow can't.
- [ ] Publishing with a validation error returns 422. Publishing with warnings requires `acknowledgeWarnings` and records them. Publishing an unchanged draft returns 409.
- [ ] Moving nodes or renaming the workflow doesn't set `hasUnpublishedChanges`. Changing any config field, node or edge does, and the dashboard badge updates live.
- [ ] The diff between two versions correctly lists added, removed, changed (with paths) and moved items, and diff mode renders them in their colors.
- [ ] Restore replaces the draft for every connected collaborator and doesn't change the live version. Rollback creates a new version with the old content and switches triggers to it immediately.
- [ ] The run monitor for a run of v2 renders v2's graph even after v3 is published and the draft has been edited further.
- [ ] A viewer can list, view and diff versions, but gets 403 when trying to publish, restore or roll back.
- [ ] A share link shows the published graph, never the draft.

`npm run check:versions` (in `server/`) covers these against a running server. It uses `check:collab`'s socket helpers for the restore broadcast.
