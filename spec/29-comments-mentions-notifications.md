# Spec: Comments, Mentions & Notifications

**Status:** Phase 3 — Tier 2
**Milestone:** M4
**Depends on:** `22-workspaces-multitenancy.md`, `23-roles-and-invitations.md`, `24-socket-auth-and-namespaced-events.md`, `28-realtime-collaboration.md`
**Revises:** `23-roles-and-invitations.md` (adds `comments:write` to the matrix; invites to existing users also notify)

## Summary

Collaboration beyond co-editing. Anyone in a workspace can leave a **comment thread** pinned to a node or to a spot on the canvas, reply, `@mention` teammates, and resolve the thread when it's settled. A workspace-wide **notification centre** (a bell with an unread count) collects the events addressed to a person: mentions, replies, invites, failed runs on workflows they watch, and approvals waiting on them (`32`).

Two pieces of infrastructure come out of this spec, and later specs reuse them: the `notify()` service, which persists a notification and pushes it over the user's socket room, and **workflow watching**.

## Goals

### 1. Comment threads

- A **thread** is anchored to exactly one of:
  - **a node** (`anchor: { type: 'node', nodeId }`): the pin follows the node as it moves, or
  - **a canvas position** (`anchor: { type: 'canvas', x, y }`): a fixed point in flow coordinates, for comments about a region ("this whole branch is slow").
- A thread holds an ordered list of **comments**: the first one opens the thread, and the rest are replies. Authors can edit or delete their own comments. Editing sets `editedAt`. Deleting the first comment deletes the whole thread; deleting a reply leaves a "comment deleted" placeholder, so the conversation still reads correctly.
- **Resolve / reopen:** anyone who can comment can resolve a thread. Resolved threads are hidden from the canvas by default (there's a "Show resolved" toggle) but stay in the thread list.
- **Node deleted:** comments shouldn't disappear because someone tidied the graph. The server listens for `28`'s `node.delete` collaboration op (and for a deletion that arrives through a whole-document save) and sets `anchor.detached = true`, keeping the last known position. Detached threads show in the thread list with a "node deleted" badge, and can be re-pinned to a canvas position. **Undoing** the delete (the same `nodeId` coming back through `28`) re-attaches the thread automatically.
- **Threads belong to the workflow, not to a version.** Publishing or restoring a version (`30`) doesn't move them. A thread whose node doesn't exist in a restored graph becomes detached, following the same rule.

### 2. Who can comment

The matrix row `comments:write` is granted to **all four roles, including viewers**. Reviewing a workflow and asking questions is the natural job of someone without edit rights, and it's the only way they can contribute. It never changes the graph, so it doesn't weaken the viewer's read-only guarantee.

| Action | Owner | Admin | Editor | Viewer |
|---|:-:|:-:|:-:|:-:|
| `comments:write`: create, reply, resolve, edit or delete your own | ✅ | ✅ | ✅ | ✅ |
| `comments:moderate`: delete anyone's comment | ✅ | ✅ | — | — |

Comments are **not** visible through a read-only share link (`18`). That link is for people outside the workspace, and a team's comments are internal discussion.

### 3. @mentions

- In the comment composer, typing `@` opens an autocomplete of **current workspace members**, from `23`'s members endpoint (cached for the session, and refetched on `workspace:role_changed`).
- A mention is stored **structurally**: `mentions: [userId]` plus a `{{@userId}}` token in the body, which is rendered as `@Name`. Name changes then show up in old comments, and plain text like `@bob` never triggers a notification by accident.
- The server **only accepts mentions of current members**. Unknown or foreign user ids are dropped before saving, so a crafted request can't notify someone outside the workspace.

### 4. Notifications

One `notify(userIds, payload)` service in `server/src/notifications/notify.js`:

1. Drops the actor themselves (nobody gets notified about their own action) and anyone who isn't a member of `payload.workspaceId`.
2. Inserts one `Notification` per recipient.
3. Emits `notification:new` to each `user:<id>` room (`24`).

Mail isn't sent. Notifications are in-app only. Invite emails still go to the Outbox (`23`).

| Kind | Fired when | Recipients |
|---|---|---|
| `mention` | A comment mentions you | Mentioned members |
| `comment_reply` | Someone replies in a thread | Everyone who has commented in it, plus the thread author |
| `invite` | You're invited and **already have an account** | The invited user (in addition to the Outbox mail) |
| `run_failed` | A run of a watched workflow ends `failed` | The workflow's watchers |
| `approval_requested` | An Approval node waits on you (`32`) | The approval's assignees |
| `approval_resolved` | An approval you requested is decided (`32`) | The user who triggered the run, and watchers |
| `role_changed` | Your role changes (`23`) | The affected member |

- **`link`** is always a client path (`/w/:slug/...`). Clicking a notification navigates there and marks it read. Since `22`'s routing puts the workspace in the URL, a notification from workspace B opens correctly while you're looking at A.
- **The bell counts across all your workspaces.** Each notification row shows its workspace name. People want to know about a mention in *any* team they're in, and a per-workspace count would hide it.
- **Invite notifications** sit outside the workspace's membership check, because the recipient isn't a member yet. `notify` accepts `{ allowNonMember: true }` for this one kind only.

### 5. Workflow watching

- `WorkflowWatch { workflowId, userId }`. Users are **auto-watched** when they create a workflow and when they first comment on it. Anyone with `workflow:read` can watch or unwatch from the Builder header ("🔔 Watching").
- `run_failed` goes to watchers, but **not** for a run the watcher cancelled themselves.
- **Collapsing:** if a scheduled workflow (`12`) fails every minute, one unread `run_failed` notification per workflow is updated in place with the count ("failed 7 times since 14:02") instead of piling up.

## Non-goals

- Email or push notification delivery, and per-kind notification preferences. Watching is the only control.
- Rich text beyond plain text, `@mentions` and auto-linked URLs. No markdown, attachments or reactions.
- Comments on runs or on individual log lines.
- Comments on a read-only share link, or anonymous comments.
- Real-time typing indicators in threads.

## Data Model

**CommentThread** (new)
```
{ _id, workspaceId, workflowId,
  anchor: { type: 'node' | 'canvas', nodeId?: string, x?: number, y?: number, detached: boolean },
  resolvedAt: Date | null, resolvedBy: ObjectId | null,
  createdBy, createdAt, updatedAt }
index { workflowId: 1, resolvedAt: 1 }
```

**Comment** (new)
```
{ _id, workspaceId, threadId, authorId, body: string (≤ 4000 chars), mentions: ObjectId[],
  editedAt: Date | null, deletedAt: Date | null, createdAt }
index { threadId: 1, createdAt: 1 }
```

**Notification** (new)
```
{ _id, workspaceId, userId,
  kind: 'mention' | 'comment_reply' | 'invite' | 'run_failed' | 'approval_requested' | 'approval_resolved' | 'role_changed',
  title: string, body: string, link: string, actorId: ObjectId | null,
  groupKey: string | null, count: number (default 1),     // collapsing, e.g. 'run_failed:<workflowId>'
  readAt: Date | null, createdAt }
index { userId: 1, readAt: 1, createdAt: -1 }
```

**WorkflowWatch** (new): `{ workflowId, userId, createdAt }`, unique on `{ workflowId, userId }`.

## API

All routes are workspace-scoped (`22`). Thread and comment lookups use `findInWorkspace`.

| Method | Path | Permission | Body / Response |
|---|---|---|---|
| GET | `/api/workflows/:id/threads` | `workflow:read` | `?resolved=true\|false` → threads with their comments and author names |
| POST | `/api/workflows/:id/threads` | `comments:write` | `{ anchor, body }` → `201` thread |
| POST | `/api/threads/:threadId/comments` | `comments:write` | `{ body }` → `201` comment |
| PATCH | `/api/comments/:commentId` | author | `{ body }` → comment |
| DELETE | `/api/comments/:commentId` | author or `comments:moderate` | `204` |
| POST | `/api/threads/:threadId/resolve` / `/reopen` | `comments:write` | → thread |
| PATCH | `/api/threads/:threadId` | `comments:write` | `{ anchor }` (re-pin a detached thread) → thread |
| PUT / DELETE | `/api/workflows/:id/watch` | `workflow:read` | `204` |
| GET | `/api/notifications` | JWT only (across workspaces) | `?unread=true&before=<cursor>` → `{ items, nextCursor, unreadCount }` |
| POST | `/api/notifications/:id/read` | recipient | `204` |
| POST | `/api/notifications/read-all` | JWT | `204` |

`/api/notifications` is the one new route **without** `requireWorkspace`, because it deliberately spans workspaces. It filters on `userId = req.userId` and then drops rows whose workspace the user has left, except `invite` rows.

## Socket contract

| Event | Room | Payload |
|---|---|---|
| `comment:created` | `workflow:<id>` | `{ threadId, comment, thread? }` (`thread` is included when the comment opens a new thread) |
| `comment:updated` | `workflow:<id>` | `{ threadId, comment }` |
| `comment:deleted` | `workflow:<id>` | `{ threadId, commentId, threadDeleted }` |
| `comment:resolved` | `workflow:<id>` | `{ threadId, resolved: boolean, by }` |
| `comment:anchor` | `workflow:<id>` | `{ threadId, anchor }` (detach, re-attach or re-pin) |
| `notification:new` | `user:<id>` | the notification, plus `unreadCount` |
| `notification:read` | `user:<id>` | `{ ids \| 'all', unreadCount }`, which keeps a second tab's bell in sync |

The `workflow:<id>` room is `24`'s, and is already joined by `28` when the Builder opens.

## UI Behavior

- **Canvas:** a "Comment" mode (shortcut `C`). Clicking a node or empty canvas drops a pin and opens the composer. Pins are small avatar bubbles showing the reply count. Node-anchored pins sit at the node's top-right corner and move with it.
- **Thread popover:** comments with author, relative time, edited marker and resolve button. The composer has `@` autocomplete, and ⌘↵ sends.
- **Thread list panel** (a tab beside the config panel): open, resolved and detached threads, with jump-to-node.
- **Viewers** see the Comment mode and can use it. It's the only canvas interaction they have.
- **Bell** in the header: an unread badge (capped at `99+`) and a dropdown of the newest 20, each showing workspace, kind icon, title and time. Unread rows are bold. There's a "Mark all read" action and a "View all" link to `/notifications`, a paginated full list.
- **Toasts:** a `notification:new` of kind `mention` or `approval_requested` also shows a toast. The other kinds only update the badge.
- **Builder header:** a Watch / Watching toggle.

## Edge Cases & Error Handling

- **Commenting on a node that another collaborator deleted a moment ago** → the server rejects a node anchor whose `nodeId` isn't in the current draft with a 409. The client re-offers the comment as a canvas-position comment at the same spot, so the text isn't lost.
- **Mentioning someone removed between autocomplete and send** → they're silently dropped from `mentions`, and the token renders as plain text.
- **A member leaves a workspace** → their past comments stay, with their name and a "(left)" suffix. They stop receiving that workspace's notifications. Unread ones from it are hidden, not deleted, and come back if they rejoin.
- **Notification storms** → a thread with 30 participants produces 30 rows per reply. That's acceptable at this scale. `run_failed` storms are collapsed by `groupKey`.
- **A notification link pointing at a deleted workflow** → the page's normal 404 ("This workflow isn't in <workspace>"). Notifications aren't cleaned up when a workflow is deleted.
- **Workspace deleted** → its threads, comments, watches and notifications are removed along with it (`22`'s cascade list gains these four collections).
- **Body over 4000 characters** → 400. An empty or whitespace-only body → 400.

## Acceptance Criteria

- [ ] A thread pinned to a node follows the node when it's moved by another collaborator, live.
- [ ] Deleting a node detaches its threads (still listed, with a "node deleted" badge). Undoing the deletion re-attaches them.
- [ ] A viewer can create, reply to and resolve threads, and still can't change the graph.
- [ ] `@mentioning` a member creates exactly one `mention` notification for them and none for the author. A crafted mention of a non-member creates nothing.
- [ ] A reply notifies every earlier participant except the replier.
- [ ] A notification from workspace B appears on the bell while viewing workspace A, and its link opens the right workflow in B.
- [ ] Marking read in one tab updates the unread count in another tab live.
- [ ] A watched workflow's failed run notifies watchers. Ten failures of a scheduled workflow collapse into one unread notification with count 10.
- [ ] Inviting an existing user creates both an Outbox message and an `invite` notification. Inviting a new email creates only the Outbox message.
- [ ] Comments never appear in the `/api/shared/:token` payload.
- [ ] Comment and notification routes return 404 for another workspace's thread, comment or notification ids.

`npm run check:collab` (extended) covers the comment sync and anchor criteria. `check:tenancy` covers the isolation criteria.
