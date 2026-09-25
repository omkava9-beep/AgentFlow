# Spec: Real-time Collaboration

**Status:** Phase 3 — Tier 1
**Milestone:** M4
**Depends on:** `20-builder-ux.md`, `22-workspaces-multitenancy.md`, `23-roles-and-invitations.md`, `24-socket-auth-and-namespaced-events.md`
**Revises:** `04-workflow-persistence.md` (last-write-wins `PUT` → server-sequenced ops), `20-builder-ux.md` (undo becomes per-user; Save button replaced by autosave; the "no collaborative editing" non-goal no longer applies)

## Summary

Several people edit the same workflow at the same time and see each other's changes as they happen, along with each other's cursors, selections, and which node each person is configuring. Edits are **operations** sent over the existing Socket.io connection. An in-process **collaboration hub** puts them in order, applies them to an authoritative in-memory draft, broadcasts them, and flushes to MongoDB on a debounce. Conflicts resolve **per entity field, last writer wins**, the model Figma describes for its multiplayer editor. It suits a graph of discrete nodes and edges far better than character-level text merging, and it's small enough to build by hand. Building it is the point, the same way the queue was.

Today a save is a whole-document `PUT` (`workflowController.update`), so two people editing would silently overwrite each other. After this spec, the Save button is gone: every change is synced within milliseconds and persisted within seconds.

## Goals

### 1. The collaboration hub (server)

`server/src/collab/hub.js` is an in-process singleton, like the queue and cache. It keeps one **session** per workflow that has at least one subscriber:

```
session = {
  workflowId, workspaceId, sessionId (random, per load),
  seq,                       // last applied sequence number
  doc: { name, nodes: Map<id, node>, edges: Map<id, edge> },
  opLog: ring buffer of the last 500 applied ops (for reconnect catch-up and opId dedupe),
  peers: Map<socketId, { userId, name, color, role, away }>,
  locks: Map<nodeId, { userId, socketId, heartbeatAt }>,
  flushTimer, dirtySince
}
```

- **Loading:** the first `workflow:subscribe` loads the workflow from MongoDB, and `seq` starts from the persisted `draftSeq`. When the last subscriber leaves, the session flushes and is dropped after a 30 s grace period, so a page reload doesn't reload from the database.
- **Serial application:** ops are applied one at a time in arrival order. Node's single thread makes that free. Each applied op gets `seq = ++session.seq`.
- **Flushing:** debounced `COLLAB_FLUSH_DEBOUNCE_MS` (1000 ms) after the last op, with a hard ceiling of `COLLAB_FLUSH_MAX_MS` (5000 ms), so a continuous editing burst still persists regularly. It writes `{ name, nodes, edges, draftSeq, updatedBy, updatedAt }` with a workspace-scoped `updateOne` (`22`). It also flushes **synchronously on demand** before anything reads the draft for real work: starting a run, publishing (`30`), saving as a template (`15`), and when the last peer leaves. On `SIGINT`/`SIGTERM`, a best-effort flush of every session runs.
- **Crash window:** a hard crash loses at most the unflushed edits (≤ 5 s). This is documented, not engineered away, consistent with the in-process queue losing jobs on restart.

### 2. Operations

Every edit becomes one op. Ops don't depend on node type: `node.update` addresses a path under `data.config`, so the new node types in `31` (transform, code, loop, approval, …) and the integration fields in `26` (`integration`, `action`, `connectionId`, `params`) need no collaboration changes.

| Op | Payload | Notes |
|---|---|---|
| `node.add` | `{ node: { id, type, position, data } }` | Client-generated id (the existing `nextId()`). A second `start` node is rejected. |
| `node.move` | `{ nodeId, position }` | Sent **once, at drag end**. Live dragging is sent as presence (Goal 4), not ops. |
| `node.update` | `{ nodeId, path: string[], value }` | `path` is relative to `data.config`, e.g. `['systemPrompt']`, `['toolConfig','to']`, `['mockOverrides','failureRate']`. `value: undefined` unsets the path. **Arrays are values**: `['candidates']` replaces the whole array. |
| `node.delete` | `{ nodeId }` | The server cascades removal of connected edges. The broadcast carries `cascade: { edgeIds }`. |
| `edge.add` | `{ edge: { id, source, target, sourceHandle?, label? } }` | Rejected for self-loops, missing endpoints, duplicates, or a **cycle**. |
| `edge.update` | `{ edgeId, field: 'label', value }` | Rejected on condition edges, mirroring `setEdgeLabel`. |
| `edge.delete` | `{ edgeId }` | |
| `workflow.rename` | `{ name }` | |
| `batch` | `{ ops: Op[] }` | Applied **atomically**: all ops or none. Used for paste/duplicate, delete-selection, a multi-node drag, and renaming a handoff candidate (which relabels edges in the same step, per `16`/`20`). |

Every op carries `opId` (a client UUID) and `baseSeq` (the last seq the client had seen). `baseSeq` is recorded for debugging and isn't needed for correctness: last-writer-wins by path doesn't need transformation.

**Server-side validation** rejects an op with a reason, and nothing is applied:

- `forbidden`: the sender lacks `workflow:edit` (viewers, per `23`). The role is cached on the peer and refreshed by `workspace:role_changed`.
- `not_found`: the target node or edge no longer exists (someone else deleted it).
- `locked`: `node.update` or `node.delete` on a node another socket has locked (Goal 5). `node.move` is allowed on locked nodes, since moving doesn't interfere with configuring.
- `cycle`, `duplicate`, `invalid`: graph rules. The cycle check is ported from `wouldCreateCycle` in `workflowStore`. `invalid` covers bad paths, including any `__proto__`, `constructor` or `prototype` segment, as well as an op over 64 KB or a document over 1 MB.

### 3. Client: optimistic apply and reconcile

`workflowStore` keeps three layers:

- **`confirmed`**: the server's document at `confirmedSeq`.
- **`pending`**: the user's own ops, sent but not yet acknowledged, in order.
- **what's displayed**: `confirmed` with `pending` replayed on top.

The rules:

- **Local edit:** apply it to the display immediately, append it to `pending`, and emit `collab:op` with an ack.
- **Remote op arrives** (`collab:op` broadcast): apply it to `confirmed`, then replay `pending` on top. With path-level last-writer-wins, that replay is the whole rebase: no operational transformation.
- **Ack `{ ok, seq }`:** move the op from `pending` into `confirmed` at that seq.
- **Reject `{ ok: false, reason }`:** drop the op from `pending`, recompute the display, and show a toast explaining why. For example, `not_found` → "Bob deleted this node", and `locked` → "Bob is editing this node".
- **Ordering guarantee:** the server applies ops serially, and Socket.io preserves order per connection, so a client always receives the broadcast for seq *n* before the ack for *n + 1*. The client asserts seq continuity. On a gap it resubscribes with `sinceSeq` (Goal 7).
- **Throttled typing:** the display updates on every keystroke, but `node.update` for a given path is sent at most every 150 ms (trailing edge), so a paragraph isn't 400 ops.

Selection (`selectedNodeId`, `selectedEdgeId`, React Flow's `selected`) and the clipboard stay **local**, and are never sent as ops.

### 4. Presence

Presence events are ephemeral. They're never given a seq, never logged, and never persisted. They're emitted with `socket.volatile`, so they're dropped rather than queued when the connection is congested.

- **Join/leave:** `presence:join { socketId, userId, name, color, role }` when someone subscribes, and `presence:leave` when they unsubscribe or disconnect. Each person's color is chosen deterministically from their `userId` (an 8-color palette readable in both themes). The subscribe ack includes the full current peer list.
- **Cursors:** `presence:cursor { x, y }` in **flow coordinates** (people have different viewports), throttled to 20 per second. It's hidden after 10 s without movement.
- **Selection:** `presence:select { nodeIds, edgeIds }` shows as a colored ring around what others have selected.
- **Live dragging:** `presence:drag { moves: [{ nodeId, position }] }` is sent during a drag, and one `node.move` (or a `batch`) op is sent on drop. Others see the node glide, and the op log records only the final position.
- **Away:** `presence:state { away }` follows `visibilitychange`. Away peers render dimmed.
- One user with two tabs is two peers. The avatar stack collapses them by `userId`, but each tab keeps its own cursor.

### 5. Soft locks on node configuration

- Opening the `NodeConfigPanel` for a node sends `collab:lock { nodeId }`. The ack is `{ ok: true }` or `{ ok: false, heldBy: { userId, name } }`.
- **If someone else holds the lock**, the panel opens **read-only** with a banner saying "Bob is editing this node". The fields are disabled but keep updating live. When the lock is released, the banner changes to "Bob finished — Edit now", which takes the lock.
- **Releasing:** closing the panel or selecting another node sends `collab:unlock`. A disconnect releases automatically. Any op from the holder, or a `collab:lock_heartbeat` every 15 s, refreshes the lock, and it expires after `COLLAB_LOCK_TTL_MS` (60 s) without one, for example when the tab is asleep. Being demoted to viewer (`23`) or evicted (`24`) releases all of that user's locks.
- Only node configuration is locked. Edge labels stay last-writer-wins, since they're a single short field, and moves are never locked.
- If the same user's other tab holds the lock, the banner says "You're editing this node in another tab".

### 6. Per-user undo and redo

`20`'s snapshot-based history would undo *other people's* edits, so history now stores **inverse ops of your own confirmed edits**:

- Each inverse is computed at apply time from the state just before the op: `node.update` gets the previous value at that path, `node.add` gets `node.delete`, and `node.delete` gets a `batch` of `node.add` (with the **same node id**) plus `edge.add` for every cascaded edge. `node.move` gets the previous position.
- Undo sends the inverse as a **new** op (new `opId`, new seq), so collaborators see it like any other edit. Redo re-sends the original.
- **Conflicts with others' edits:** before sending an inverse, the client compares each path's current confirmed value with the value your op set. If a collaborator has changed it since, that part is **skipped**, and a toast says "Couldn't undo the label change — Bob edited it after you." Undo never clobbers newer work by someone else. Inverse edges whose endpoints no longer exist are dropped the same way.
- Coalescing (`20`'s 500 ms per-path window) and drag gestures (one history entry per drag) keep working. Only what the stack stores changes.
- History is per session and resets on load (unchanged). A full-document replace (Goal 8) clears **every** collaborator's history, because inverses computed against the replaced document no longer mean anything. A toast explains why.

### 7. Joining, catch-up and reconnect

- `workflow:subscribe { workflowId, sinceSeq?, sessionId? }` (room authorization from `24`). The ack is one of:
  - `{ ok, snapshot: { sessionId, seq, name, nodes, edges, peers, locks } }` on first join, or whenever catch-up isn't possible;
  - `{ ok, catchUp: { sessionId, ops } }` when `sessionId` matches and the op log still covers `sinceSeq`.
- The join and the snapshot are produced in the same synchronous handler, so no op can fall into a gap between them.
- **Reconnect:** resubscribe with `sinceSeq` and `sessionId`, apply the catch-up or snapshot, then **resend `pending`** in order.
- **Duplicate ops are ignored:** an `opId` still in the op log is acked with its original seq and not applied again. This makes resending pending ops safe.
- **Server restarted** (a new `sessionId`) → a snapshot with `reason: 'server_restarted'`. The client rebases its pending ops onto it, and edits that were acked but never flushed are lost. This is the documented crash window from Goal 1.
- **Offline editing:** edits keep queuing in `pending`, and the status pill says "Offline — 4 changes will sync when you reconnect". `useUnsavedChangesGuard` now fires only while `pending` isn't empty.

### 8. REST and non-socket writers

- `GET /api/workflows/:id` returns the **hub's in-memory draft** when a session is live, never an older database copy, plus `draftSeq`.
- `PUT /api/workflows/:id` **stays**, for scripts, the check suites and API callers. It no longer writes MongoDB directly. It goes through `hub.replace()`, which validates the document (cycle check), assigns a seq, flushes, and broadcasts `collab:snapshot { reason: 'replaced', by }` to live collaborators. `30`'s restore uses the same path, with `reason: 'restored'`.
- **Deleting a workflow** that has a live session → `collab:closed { reason: 'deleted', by }`. Clients route to the dashboard with a toast.

### 9. Autosave UI

- **The Save button is removed.** A sync status pill sits in its place and shows one of: *All changes saved*, *Saving…* (pending ops waiting for an ack), *Offline — N changes pending*, or *Reconnecting…*. A rejection shows a toast and clears on its own.
- The Run button is disabled only while pending ops exist ("Syncing…"), instead of while `dirty`. Validation errors and warnings still block runs, per `20`. `30`'s Publish uses the same rules.
- "Save as template" no longer needs "save first": the server flushes the hub before taking the snapshot.

### 10. Hook for comments (`29`)

`node.delete` calls `hub.onNodeDeleted(workflowId, nodeId, lastKnownNode)` after applying the op. `29` subscribes to it and marks threads pinned to that node as `orphaned`, keeping the last-known label and position. Undoing the delete re-adds the **same node id** (Goal 6), which fires `hub.onNodeRestored`, and the threads reattach. Collaboration itself knows nothing about comments beyond these two hooks.

## Non-goals

- CRDT or operational-transformation libraries (Yjs, Automerge, ShareDB). The hand-built hub is a deliberate choice.
- Character-level merging inside text fields. Two people typing into the same system prompt at once is prevented by soft locks. Without a lock, the field is last-writer-wins.
- Keeping unsynced offline edits across a page reload.
- Persisting the op log, or history across sessions. Version history is `30`.
- Following another user's viewport, voice/video, or chat. Comments are `29`.
- Collaborative editing of trigger settings. Triggers keep their own immediate-save endpoints (`12`/`13`/`21`). Changes to them are broadcast as `workflow:triggers_changed` so other peers' Trigger panels refresh, but they aren't sequenced ops.
- Running more than one server process. Sessions live in one process, per `CLAUDE.md`.

## Data Model

**Workflow**: adds `draftSeq: number` (the last seq flushed, default 0) and `updatedBy: ObjectId<User>`.

There's no new collection. Sessions, the op log, presence and locks are in memory only.

New env variables (documented in `.env.example`): `COLLAB_FLUSH_DEBOUNCE_MS=1000`, `COLLAB_FLUSH_MAX_MS=5000`, `COLLAB_LOCK_TTL_MS=60000`. The check suite shortens them.

## API

| Method | Path | Change |
|---|---|---|
| GET | `/api/workflows/:id` | Returns the live hub draft when a session exists, and includes `draftSeq` |
| PUT | `/api/workflows/:id` | Routed through `hub.replace()`. Broadcasts `collab:snapshot`. Response unchanged. |
| DELETE | `/api/workflows/:id` | Also closes the live session (`collab:closed`) |

## Socket contract

All of these are in room `workflow:<id>`. Joining is authorized by `24`.

| Event | Direction | Payload |
|---|---|---|
| `workflow:subscribe` | client → server | `{ workflowId, sinceSeq?, sessionId? }` → ack `{ ok, snapshot? , catchUp?, error? }` |
| `workflow:unsubscribe` | client → server | `{ workflowId }` |
| `collab:op` | client → server | `{ workflowId, op }` → ack `{ ok: true, seq }` or `{ ok: false, reason, current? }` |
| `collab:op` | server → others in room | `{ seq, op, by: { userId, socketId }, cascade? }` |
| `collab:snapshot` | server → room | `{ sessionId, seq, name, nodes, edges, reason: 'replaced' \| 'restored' \| 'server_restarted', by? }` |
| `collab:lock` / `collab:unlock` / `collab:lock_heartbeat` | client → server | `{ workflowId, nodeId }` → ack `{ ok, heldBy? }` (lock only) |
| `collab:locked` / `collab:unlocked` | server → room | `{ nodeId, by? }` |
| `collab:closed` | server → room | `{ reason: 'deleted', by }` |
| `presence:join` / `presence:leave` | server → room | `{ socketId, userId, name, color, role }` / `{ socketId }` |
| `presence:cursor` / `presence:select` / `presence:drag` / `presence:state` | client → server → others | `{ x, y }` / `{ nodeIds, edgeIds }` / `{ moves }` / `{ away }`, relayed with `socketId` |
| `workflow:triggers_changed` | server → room | `{ triggers }` (after any trigger endpoint writes) |

Viewers get every server-to-client event and may send presence, but their `collab:op` and `collab:lock` calls are rejected as `forbidden`.

## UI Behavior

- **Header avatar stack** (up to 4, then "+N"): hovering shows the name, role, and what they're doing ("editing *Summarizer*", "viewing"). Clicking one pans the canvas to that person's cursor.
- **Cursors:** a colored arrow with a name tag, positioned through React Flow's viewport transform, and hidden when off-screen or idle.
- **Remote selection:** a ring in the peer's color, with a small avatar chip on the node's corner. **Locked nodes** show a padlock chip with the holder's name.
- **Config panel** in read-only mode: a banner, disabled fields that still update live, and "Edit now" once the lock is released.
- **Sync pill** replaces Save (Goal 9). Rejected ops and history resets show toasts.
- **Viewers** see everything live and appear in the avatar stack with a "viewer" tag. Their canvas stays read-only (`23`).

## Edge Cases & Error Handling

- **A deletes a node while B is updating its config** → whichever the server receives first wins. If the delete lands first, B's update is rejected as `not_found`. If B holds the lock, A's delete is rejected as `locked`.
- **Two edges that each look fine but together form a cycle**, sent at the same moment → the serial application order means exactly one is accepted, and the other is rejected as `cycle`.
- **Both add a Start node** → one is accepted, and the other is rejected as `invalid` with "A workflow can only have one Start node".
- **Paste arrives after someone deletes a node the pasted edges point at** → pasted edges only ever connect pasted nodes (`20`), so this can't happen. For any other `batch`, one invalid part rejects the whole batch.
- **Same field edited without a lock** (for example an edge label) → last writer wins. The losing client's optimistic value is replaced when the winner's op arrives. No merge is attempted.
- **Seq gap detected** (a missed broadcast) → the client resubscribes with `sinceSeq`, and catch-up fills the gap, or a snapshot arrives if the op log has rolled over.
- **Evicted mid-session** (`24`) → `presence:leave` is sent to the others, the user's locks are released, and their client routes away (`23`).
- **Demoted to viewer mid-drag** → the drop's `node.move` is rejected as `forbidden`, and the node snaps back to its confirmed position.
- **Workflow opened in a stale tab from before this spec** → the old client's `PUT` still works (it goes through `hub.replace()`) and shows up as a snapshot to live collaborators. It's clumsy but safe.
- **An op for a workflow the socket hasn't subscribed to** → `forbidden`. Ops are only accepted from room members.

## Acceptance Criteria

- [ ] Two editors and a viewer on one workflow: an edit by either editor appears for the other two within 200 ms on localhost.
- [ ] Concurrent edits to **different** fields of the same node both survive. Concurrent edits to the **same** field converge, on all three clients and in MongoDB after a flush, to the value with the higher seq.
- [ ] Of two edges that jointly form a cycle, sent at the same moment, exactly one is accepted.
- [ ] A delete racing an update always ends with all clients showing the same graph. The losing op's author sees an explanatory toast.
- [ ] A viewer's `collab:op` is rejected as `forbidden`, and their canvas can't produce one.
- [ ] Opening a node's config panel locks it. A second editor sees it read-only with the holder's name. Closing the panel, disconnecting, or letting the lock go idle past its TTL releases it.
- [ ] A late joiner's snapshot is identical to the other peers' state. Reconnecting after missing ops catches up without a full reload, and resent pending ops aren't applied twice.
- [ ] Undo reverts only your own edits. Undoing a field someone else has since changed is skipped with a toast. Undoing a node delete restores the node with its original id and edges.
- [ ] Dragging a node shows it moving live for peers, and produces exactly one `node.move` op.
- [ ] A `PUT /api/workflows/:id` while three peers are connected produces a `collab:snapshot` on all three and clears their undo history.
- [ ] No Save button remains. Closing the tab with pending ops warns, and closing it with none doesn't.
- [ ] Edits are in MongoDB within `COLLAB_FLUSH_MAX_MS` of the last op during continuous editing.

`npm run check:collab` (in `server/`) runs three socket.io clients and REST calls against a running server with shortened flush and lock timings. The client-side reconcile and undo-conflict logic is covered in `client`'s `check:logic`.
