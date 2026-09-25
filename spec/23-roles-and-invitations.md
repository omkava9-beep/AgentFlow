# Spec: Roles, Invitations & Team Management

**Status:** Phase 3 — Tier 1
**Milestone:** M4
**Depends on:** `22-workspaces-multitenancy.md`
**Revises:** `18-rbac.md` (adds workspace roles alongside share links; adds a workspace-wide sharing switch)

## Summary

Gives workspaces real teams. There are four roles, backed by a single server-side permission matrix. Owners and admins can invite people by email: the invite is a token link, which also appears in a dev **Outbox** because nothing sends real email. A Members page lets them change roles and remove people. The client renders every control from the permission list the server sends, so the matrix exists in exactly one place.

## Goals

### 1. Roles and the permission matrix

The matrix lives in `server/src/tenancy/permissions.js` and nowhere else:

| Action | Owner | Admin | Editor | Viewer |
|---|:-:|:-:|:-:|:-:|
| `workflow:read`: canvas, run history, run monitor, analytics | ✅ | ✅ | ✅ | ✅ |
| `workflow:edit`: create, edit, delete workflows | ✅ | ✅ | ✅ | — |
| `workflow:run`: manual run, cancel, re-run | ✅ | ✅ | ✅ | — |
| `triggers:manage`: schedule, webhook, event subscription | ✅ | ✅ | ✅ | — |
| `share:manage`: create or revoke a read-only share link (`18`) | ✅ | ✅ | ✅ | — |
| `templates:create` / `templates:use` | ✅ | ✅ | ✅ | — |
| `members:read` | ✅ | ✅ | ✅ | ✅ |
| `members:invite` | ✅ | ✅ | — | — |
| `members:manage`: change roles, remove members | ✅ | ✅¹ | — | — |
| `workspace:update`: name, slug, settings | ✅ | ✅ | — | — |
| `workspace:delete` | ✅ | — | — | — |
| `apiKeys:manage` (`24`) | ✅ | ✅ | — | — |
| `connections:manage` (`25`) | ✅ | ✅ | — | — |
| `connections:use`: pick a connection in a node (`25`) | ✅ | ✅ | ✅ | — |
| `audit:read` (`34`) | ✅ | ✅ | — | — |
| `workflow:publish`: publish, roll back (`30`) | ✅ | ✅ | ✅ | — |
| `code:author`: add a Code node or edit its source (`31`) | ✅ | ✅ | — | — |
| `runs:approve`: decide an approval you're assigned to (`32`) | ✅ | ✅ | ✅ | ✅ |
| `runs:approve_any`: decide any approval in the workspace (`32`) | ✅ | ✅ | — | — |
| `comments:write`: comment, reply, resolve your own threads (`29`) | ✅ | ✅ | ✅ | ✅ |
| `comments:moderate`: edit, delete or resolve anyone's comments (`29`) | ✅ | ✅ | — | — |
| `workspace:billing`: change plan (`33`) | ✅ | — | — | — |

¹ Admins can manage **editors and viewers only**. They can't change or remove an owner or another admin, can't promote anyone to admin or owner, and can't change their own role.

Later specs add rows to this table, not new role checks scattered through controllers. The rows from `29`–`33` are already listed above so the whole matrix can be read in one place. `36`'s operator status page is gated by `OPERATOR_EMAILS`, not by a role.

- **Server:** `requirePermission('workflow:edit')` middleware returns **403** `You don't have permission to do that` when the role lacks the action. A 403 is correct here because the caller is a member and already knows the resource exists. A non-member still gets `22`'s 404.
- **Client:** every workspace payload (`/api/workspaces`, `/by-slug`, `/me`) includes `permissions: string[]`, the actions allowed for the caller's role, computed by the server. A `useCan(action)` hook reads it. The client has no copy of the matrix.
- **Multiple owners are allowed.** A workspace must always have **at least one owner**. Ownership is transferred by promoting someone to owner, then stepping down.

### 2. Invitations

- Owners and admins invite by **email + role** (`admin`, `editor` or `viewer`; only owners can invite admins). Nobody can be invited straight to `owner`.
- Creating an invite produces a random 32-byte token. **Only its SHA-256 hash is stored.** The token itself goes out in:
  - the API response, as `inviteUrl`, so the inviter can copy the link directly, and
  - an **Outbox** message addressed to the invitee.
- Invites expire after **7 days**. Resending issues a new token (the old link dies) and a new expiry. Revoking kills the link.
- There's at most one pending invite per (workspace, email). Inviting the same address again returns the existing pending invite rather than a duplicate.
- **Accepting requires signing in as the invited email** (case-insensitive). This stops a forwarded link from being used by someone else. An invitee without an account sees the invite page, signs up with the email prefilled, and lands back on the accept step.
- Accepting creates the membership with the invited role and marks the invite `accepted`. If the user is already a member, accepting just marks it accepted and doesn't change their existing role.

### 3. Outbox (dev mail)

No real email is sent (a phase-3 non-goal). Everything that "would be emailed" is written to an `OutboxMessage` collection instead:

- `/outbox` is a signed-in page that works like an inbox. It shows **only messages addressed to the signed-in user's email**. Showing every message would leak other tenants' invites.
- The SMTP integration (`27`) writes here too, which is why the model is generic (`kind`, `to`, `subject`, `text`) rather than invite-specific.
- For the demo, the inviter's "Copy invite link" is the main path. The Outbox is what the invitee sees after signing up.

### 4. Members management

- Members page: name, email, role, and joined date, with a role dropdown and a remove action, both gated by `members:manage` and the admin restriction.
- **Leaving:** any member can leave from the Members page or the switcher, except the last owner.
- **Live effect of role changes and removals:** the server tells the affected user's open sessions (through `24`'s `user:<id>` room):
  - **`workspace:role_changed`**: the client refetches permissions, and the UI flips live. For example, a Builder open as an editor becomes read-only when the user is demoted to viewer.
  - **`workspace:access_revoked`**: the client leaves the workspace and routes to the personal workspace with a toast. `24` also evicts the user's sockets from every room in that workspace.

### 5. Workspace-wide sharing switch

`Workspace.settings.publicSharing` (defaults to `true`, managed through `workspace:update`):

- When it's `false`, `POST /api/workflows/:id/share` returns `403 Public sharing is disabled for this workspace`.
- Turning it off **clears every `shareToken` in the workspace**, so it works as a kill switch. Turning it back on doesn't revive old links, and editors generate new ones. That's safer than a switch that could quietly republish links everyone assumed were dead.

### 6. Viewer experience

A viewer opening the Builder gets the read-only canvas that already exists for `18` (no connection handles, no node dragging, no config editing). They get no Save, Run or Share buttons, and a read-only Trigger panel. Config panel fields are rendered disabled rather than hidden, so viewers can still read how a node is configured. The server enforces all of this regardless of what the UI shows.

## Non-goals

- Custom roles or per-workflow permissions. Roles apply to the whole workspace.
- Real email delivery, SSO, SAML or SCIM (phase-3 non-goals).
- Domain-based auto-join ("anyone @acme.com can join").
- Seat limits and billing. Plans and quotas are in `33`.
- Guest access to a single workflow. The read-only share link (`18`) covers that.

## Data Model

**Invitation** (new)
```
{ _id, workspaceId, email: string (lowercase), role: 'admin' | 'editor' | 'viewer',
  tokenHash: string, invitedBy: ObjectId<User>,
  status: 'pending' | 'accepted' | 'revoked' | 'expired',
  expiresAt: Date, acceptedBy: ObjectId<User> | null, createdAt }
index { tokenHash: 1 } (unique);  index { workspaceId: 1, email: 1, status: 1 }
```
`expired` is derived when an invite is read (`status === 'pending' && expiresAt < now`) and written back lazily. No sweeper job is needed.

**OutboxMessage** (new)
```
{ _id, to: string (lowercase), subject, text, kind: 'invite' | 'smtp' | 'notification',
  workspaceId: ObjectId | null, meta: Mixed, createdAt }
index { to: 1, createdAt: -1 }
```

**Workspace**: `settings.publicSharing` (already declared in `22`).

## API

| Method | Path | Auth | Body / Response |
|---|---|---|---|
| GET | `/api/workspaces/:id/members` | `members:read` | `[{ userId, email, name, role, joinedAt }]` |
| PATCH | `/api/workspaces/:id/members/:userId` | `members:manage` | `{ role }` → member |
| DELETE | `/api/workspaces/:id/members/:userId` | `members:manage`, or self | `204`. When `userId` is the caller, it's a leave. |
| GET | `/api/workspaces/:id/invitations` | `members:invite` | pending invites (never the token) |
| POST | `/api/workspaces/:id/invitations` | `members:invite` | `{ email, role }` → `201 { invitation, inviteUrl }` |
| POST | `/api/workspaces/:id/invitations/:invId/resend` | `members:invite` | → `{ invitation, inviteUrl }` (new token) |
| DELETE | `/api/workspaces/:id/invitations/:invId` | `members:invite` | `204` (revoke) |
| GET | `/api/invitations/:token` | **none** | `{ workspaceName, invitedByName, email, role, status }` |
| POST | `/api/invitations/:token/accept` | JWT | → `{ workspace }` (with `role` and `permissions`) |
| GET | `/api/outbox` | JWT | the caller's messages, newest first |
| PATCH | `/api/workspaces/:id` | `workspace:update` | now also accepts `{ settings: { publicSharing } }` |

- The `/api/workspaces/:id/**` routes take the workspace from the path. `requireWorkspace` accepts the path id in place of the header, and it's an error if the two disagree.
- `inviteUrl` is built from `CLIENT_ORIGIN` (`/invite/:token`), following `18`'s rule that links to React pages use the client origin.
- `GET /api/invitations/:token` is unauthenticated, like `18`'s share endpoint, and returns only what the invite page needs. For an unknown, revoked or accepted token it returns **404**. An expired one returns `{ status: 'expired' }` so the page can say so.

## UI Behavior

- **Settings area** at `/w/:slug/settings`, with tabs for **General** (name, slug with a URL-change warning, public-sharing switch, and a danger-zone delete for owners) and **Members**. `24`, `25` and `33` add tabs later.
- **Members tab:** a member table, an "Invite people" dialog (email + role select, with admin only offered to owners), and after sending, the invite link with a copy button. There's also a Pending invites list with copy link, resend, revoke and expiry. Controls the caller can't use are hidden, not disabled.
- **`/invite/:token`** (public route): a card saying "<inviter> invited you to <workspace> as <role>". Depending on who's looking:
  - signed out: *Sign in* / *Create account* with the email prefilled, returning to this page afterwards;
  - signed in as the right email: *Accept*;
  - signed in as a different email: "This invite was sent to x@… — sign in with that account";
  - expired or invalid: a clear message and a link home.
- **`/outbox`**: a simple inbox list with message detail. Invite messages render their link as a button.
- **Role badge** in the workspace switcher and the Members table. The viewer read-only mode is described in Goal 6.

## Edge Cases & Error Handling

- **Last owner tries to demote themselves, leave, or be removed** → 400 `A workspace needs at least one owner. Promote someone else first.`
- **Admin tries to change or remove an owner or admin, promote to admin, or change their own role** → 403.
- **Inviting an email that's already a member** → 409 `Already a member`.
- **Accepting with the wrong signed-in email** → 403, with the invited address in the message (the invitee already knows it; it's their invite).
- **Accepting a revoked or already-accepted token** → 404. An expired one → 410, with the page showing "expired, ask for a new one".
- **Resend** → the old token stops working immediately (it gets a new hash).
- **A user removed while they have the Builder open with unsaved changes** → `workspace:access_revoked` routes them away. Their unsaved edits are lost, and the toast says so. That's acceptable, since they no longer have access.
- **Role changed mid-request** → each request re-reads the membership (`22`), so the next request sees the new role. No permission caching exists to go stale.
- **Invite links are credentials.** The token is never logged, only its hash is stored, and the invite list API never returns it after creation (except in a resend response).

## Acceptance Criteria

- [ ] Every cell of the permission matrix is enforced server-side: each action, called with each role, returns success or 403 as the matrix specifies (checked exhaustively in `check:tenancy`).
- [ ] The client's visible controls match `permissions` for each role, and the client source contains no role-name comparisons outside `useCan`.
- [ ] An invite link opened signed out → sign up with the prefilled email → accept → the new member lands in the workspace with the invited role.
- [ ] The invite appears in the invitee's `/outbox` and in nobody else's.
- [ ] A wrong-email accept returns 403. Revoked, resent-old and accepted tokens return 404. An expired one returns 410.
- [ ] Invitation tokens are stored only as hashes (verified in the database).
- [ ] The last owner can't leave, demote themselves or be removed. Admins can't touch owners or admins.
- [ ] Demoting an editor with the Builder open flips it read-only without a reload. Removing a member sends them out of the workspace live.
- [ ] Turning public sharing off makes every existing share link in that workspace 404, and new share creation returns 403.
- [ ] A viewer can open workflows and run history but can't save, run, cancel, share or change triggers, whether through the UI or the API.
