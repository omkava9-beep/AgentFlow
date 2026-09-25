# Spec: Audit Log

**Status:** Phase 3 — Tier 3
**Milestone:** M4
**Depends on:** `22-workspaces-multitenancy.md`, `23-roles-and-invitations.md`, `24-socket-auth-and-namespaced-events.md`, `25-secrets-and-connections.md`, `30-workflow-versioning.md`
**Revises:** `22` (the workspace-deletion cascade gains `AuditEvent`)

## Summary

Once a workspace has several people, API keys and stored credentials, "who changed this, and when?" becomes a real question. This spec adds an **append-only audit log** of security- and administration-relevant actions: membership, roles, invitations, API keys, connections, publishing, sharing, triggers and workspace settings. Every entry is written through one `audit()` helper and **redacted** so it can never contain a secret. Owners and admins read it from a filterable Settings page.

It's deliberately *not* an activity feed of every edit. Graph changes are already covered by version history (`30`), and runs are covered by run history (`11`). The audit log records the actions that change **who can do what** or **what runs where**.

## Goals

### 1. What gets audited

| Action | Fired by | Target |
|---|---|---|
| `workspace.created` / `workspace.updated` / `workspace.deleted` | `22` | workspace (`updated` records which fields changed: name, slug, settings) |
| `workspace.plan_changed` | `33` | workspace |
| `member.invited` / `invitation.resent` / `invitation.revoked` / `invitation.accepted` | `23` | invitation (email, role) |
| `member.role_changed` / `member.removed` / `member.left` | `23` | member |
| `apikey.created` / `apikey.revoked` | `24` | API key (name, prefix, scopes) |
| `connection.created` / `connection.updated` / `connection.deleted` / `connection.tested` | `25` | connection (integration, name, mode; never credentials) |
| `workflow.deleted` / `workflow.published` / `workflow.restored` | `22` / `30` | workflow (and version number) |
| `share.enabled` / `share.disabled` / `share.disabled_workspace` | `18` / `23` | workflow, or the workspace for the kill switch |
| `trigger.updated` / `webhook.regenerated` | `12` / `13` / `21` | workflow (`meta.kind`: `schedule` / `webhook` / `event`) |
| `template.deleted` | `36` | template |

**Deliberately not audited:** every workflow edit (already versioned), runs (already in run history), comments (`29`), and reads. Writing those in would drown the entries that matter.

### 2. One helper, `audit(req, action, target, details)`

In `server/src/audit/audit.js`:

- **Actor** comes from the request:
  - `user` (`req.userId`, plus an **email snapshot**, so the entry still reads correctly after the user leaves),
  - `apiKey` (`req.apiKey`: id, name and prefix, for actions taken through `24`'s public API), or
  - `system` (called with `{ system: 'migration' | 'scheduler' | 'seed' }` when there's no request).
- **Workspace** comes from `req.workspaceId`, or from the target document for system actions.
- **`summary`** is a human-readable sentence built at write time: "alice@acme.test changed bob@acme.test's role from editor to viewer". The list renders without joins, and stays readable after the people or objects it mentions are deleted.
- **`before` / `after`** are small objects holding only the changed fields, passed through **`redact()`** (Goal 3).
- **`ip`** is `req.ip`. It's informational at this scale, since there's no proxy and `trust proxy` isn't set.
- It's called **after** the mutation succeeds, inside the same controller. If the audit insert itself fails, the error is logged loudly (`[audit] FAILED to record member.removed …`) and the request still succeeds. The deployment is a single MongoDB instance without transactions (a standalone `mongod` doesn't support them), and failing an already-committed mutation would leave the client confused *and* the log incomplete. That limitation is documented rather than engineered around.

### 3. Redaction: the log must never become a secret store

`redact(obj)` runs on `before`, `after` and `meta`:

- It drops any key matching `/secret|token|password|passphrase|credential|authorization|api[-_]?key|cookie/i`, at any depth.
- It drops every field that an integration's auth schema (`25`/`26`) marks `secret: true`.
- It replaces removed values with `"[redacted]"`, so the entry still shows that the field **changed**, just not to what.
- It truncates strings longer than 500 characters.

Webhook tokens, share tokens, invite tokens, API keys and connection credentials therefore can't appear in the log. `check:audit` verifies this by searching every audit document for the known secret values it creates.

### 4. Append-only

- **No update or delete routes exist.** The API is list-only.
- The `AuditEvent` model registers Mongoose middleware for `updateOne`, `updateMany`, `findOneAndUpdate`, `replaceOne`, `deleteOne`, `deleteMany`, `findOneAndDelete` and document `save()` on an existing document. It **throws** `AuditEvent is append-only`. Accidental modification from application code fails loudly.
- **The single sanctioned delete path** is `22`'s workspace-deletion cascade, through an explicit `purgeWorkspaceAudit(workspaceId)` that uses the raw collection driver. Once a workspace is gone, nobody is a member and nobody can read its log. `workspace.deleted` is also written to the server console (actor, workspace name, time), so the deletion itself leaves a trace.
- This is enforced in code, not cryptographically. Someone with direct database access can still alter it, which is acceptable for this project.

### 5. Reading the log

- Settings → **Audit log** tab, gated by `audit:read` (owner and admin, as already listed in `23`'s matrix).
- **Newest first**, with keyset (cursor) pagination on `(createdAt, _id)`. Offset pagination would skip or repeat rows as new events arrive.
- **Filters:** action (exact, or a category prefix like `member.*`), actor (a member, or "API keys", or "System"), target type, and date range.
- **CSV export** of the current filter (up to 10,000 rows), for "send this to security" workflows.

## Non-goals

- Retention policies, archiving, or tamper-evident hash chains.
- Streaming audit events to an external system (a SIEM or webhook).
- Auditing reads ("who viewed this workflow").
- A per-user activity feed. That's what notifications (`29`) and version history (`30`) are for.

## Data Model

**AuditEvent** (new)
```
{ _id, workspaceId,
  actorType: 'user' | 'apiKey' | 'system', actorId: ObjectId | null, actorLabel: string,  // email, key name, or 'migration'
  action: string,                      // dotted, from the table above
  targetType: 'workspace' | 'member' | 'invitation' | 'apiKey' | 'connection' | 'workflow' | 'template',
  targetId: ObjectId | null, targetLabel: string,
  summary: string, before: Mixed | null, after: Mixed | null, meta: Mixed | null,
  ip: string | null, createdAt }
index { workspaceId: 1, createdAt: -1, _id: -1 };  index { workspaceId: 1, action: 1, createdAt: -1 }
```
There's no `updatedAt`. The schema uses `timestamps: { createdAt: true, updatedAt: false }`.

## API

| Method | Path | Permission | Response |
|---|---|---|---|
| GET | `/api/workspaces/:id/audit` | `audit:read` | `?action=member.*&actorId=&actorType=&targetType=&from=&to=&before=<cursor>&limit=50` → `{ items, nextCursor }` |
| GET | `/api/workspaces/:id/audit/export` | `audit:read` | the same filters → `text/csv` attachment |

`limit` is capped at 100. `before` is an opaque base64 of `createdAt|_id`. An invalid cursor → 400.

## UI Behavior

- **Audit log tab:** a table with time (relative, with absolute on hover), actor (avatar, or a key badge for API keys, or a gear for System), action (a colour-coded category badge: members, access, connections, workflows, workspace), and the summary sentence. A row expands to show a `before → after` field diff with redacted values rendered as `••••`.
- A filter bar above the table. "Load more" at the bottom rather than numbered pages, matching the cursor API. An "Export CSV" button.
- An empty state: "No administrative activity yet. Changes to members, keys, connections and sharing will appear here."
- Admins and owners also see a small "Last change: bob@acme.test revoked API key 'zapier' · 2h ago" line on the Members and API keys tabs, linking to the filtered log.

## Edge Cases & Error Handling

- **An actor later removed from the workspace** → their entries keep `actorLabel`, and the UI appends "(no longer a member)".
- **A target later deleted** → `targetLabel` and `summary` keep the entry readable, and deep links from the row are hidden.
- **A bulk action** (the public-sharing kill switch clearing 12 share tokens) → one `share.disabled_workspace` event with `meta.count: 12`, not 12 events.
- **An action through the public API** → `actorType: 'apiKey'`. The key's creator isn't shown as the actor, because they didn't perform the action.
- **Cursor pagination while new events are written** → new events appear only when the list is refreshed from the top. Pages never repeat or skip.
- **Export over 10,000 rows** → the first 10,000 rows, with a final CSV comment line saying "truncated — narrow the date range".
- **Foreign workspace id** → 404, per `22`.

## Acceptance Criteria

- [ ] Every action in the Goal 1 table produces exactly one `AuditEvent` with the correct actor, target and summary.
- [ ] Actions through a workspace API key are recorded with `actorType: 'apiKey'` and the key's name.
- [ ] No audit document contains any webhook token, share token, invite token, API key or connection credential created during the check, at any depth.
- [ ] `AuditEvent.updateOne`, `deleteOne` and `save()` on an existing document throw. There are no update or delete routes.
- [ ] Deleting a workspace removes its audit events through `purgeWorkspaceAudit` only, and logs the deletion to the console.
- [ ] Editors and viewers get 403 on the audit routes. A foreign workspace gets 404.
- [ ] Cursor pagination returns every event exactly once while new events are inserted between page fetches.
- [ ] Action-prefix, actor and date filters combine correctly. CSV export honours them.

`npm run check:audit` (in `server/`) covers these against a running server, alongside `check:tenancy`.
