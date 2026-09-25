# Spec: Workspaces & Tenant Isolation

**Status:** Phase 3 — Tier 1
**Milestone:** M4
**Depends on:** `01-auth.md`, `04-workflow-persistence.md`
**Revises:** `01-auth.md` (ownership model), `04-workflow-persistence.md` (scoping), `08-in-memory-cache.md` (cache key), `11`/`14`/`15`/`18`/`21` (every `ownerId` check)

## Summary

Introduces the **workspace** as the tenant boundary. Every workflow, run, template and sandbox record belongs to exactly one workspace, and users reach them through a **membership**, not through ownership. A user can belong to several workspaces and switch between them. Every user gets a personal workspace at registration, and existing data is migrated into it on first boot.

This spec is load-bearing for the whole phase. Every later phase-3 feature assumes `req.workspaceId` exists and that tenant data can only be reached through the scoped helpers defined here. Roles and the permission matrix are defined in `23`, and socket isolation in `24`. This spec builds the plumbing both of them plug into.

## Goals

### 1. Workspaces and memberships

- A **Workspace** has a name, a unique URL slug, a plan (used by `33`), and a `personal` flag.
- A **Membership** links a user to a workspace with a role (`owner` / `admin` / `editor` / `viewer`; meanings in `23`). There is one membership per (workspace, user) pair.
- **Registration** creates the user, a personal workspace named `"<name>'s workspace"`, and an `owner` membership, all together. If any step fails, the whole registration fails. Leaving a user with no workspace isn't recoverable from the UI.
- Users also get an optional display **`name`** (defaulting to the local part of their email). It's needed for member lists and for presence in `28`.

### 2. How a request selects its workspace

- **Authenticated app API:** each tenant-scoped request carries an `X-Workspace-Id` header. The existing route paths (`/api/workflows/:id`, …) don't change. Resource ids are globally unique ObjectIds, so the path identifies the resource and the header identifies which tenant's context the caller is claiming.
- **Client routes** are prefixed `/w/:slug/`, for example `/w/acme/workflows/:id`. The URL decides the workspace, so a link one teammate pastes to another, or a notification link (`29`), opens in the right workspace. The client resolves the slug to an id and sends the header.
- **External callers** (events, public API; spec `24`) put the slug in the path and authenticate with an API key, because they have no session to carry a header.

A header was chosen over prefixing every API path (`/api/w/:id/workflows`) because it keeps every existing API module, route and check script unchanged except for one interceptor. The client URL prefix still gives users the visible, shareable workspace context.

### 3. `requireWorkspace` middleware

Runs after `requireAuth` on every tenant-scoped router.

1. Reads `X-Workspace-Id`. If it's missing, returns **400** `X-Workspace-Id header is required`.
2. Loads the `Membership` for `(workspaceId, req.userId)`. If the id is malformed, the workspace doesn't exist, or the user isn't a member, it returns **404** `Workspace not found`. All three are deliberately indistinguishable.
3. Sets `req.workspaceId`, `req.role`, and `req.membership`.

`requirePermission(action)` (defined in `23`) runs after it. Until `23` lands, every role is treated as `editor` for workflow actions and only `owner` can manage the workspace.

### 4. Scoped data access, the one rule that prevents leaks

All tenant data access in controllers goes through `server/src/tenancy/scoped.js`:

```
scopedFilter(req, extra)            → { workspaceId: req.workspaceId, ...extra }
findInWorkspace(Model, id, req)     → Model.findOne({ _id: id, workspaceId }) or throw HttpError(404)
createInWorkspace(Model, req, doc)  → Model.create({ ...doc, workspaceId: req.workspaceId, createdBy: req.userId })
```

- `findInWorkspace` returns 404 for a malformed ObjectId too, rather than letting a Mongoose `CastError` surface as a 500.
- **Controllers must not call `findById`, `find`, `findOne` or `aggregate` on a tenant model directly.** `check:tenancy` enforces this with a static scan (see Acceptance). The only exceptions are the capability-token lookups listed below, which are marked with a `// tenancy: capability lookup` comment that the scan allows.
- `findOwned()` in `workflowController.js` is deleted. Its callers move to `findInWorkspace`.

### 5. Non-HTTP paths carry the workspace too

The engine, scheduler and triggers don't run inside a request, so they take the workspace from the workflow document:

- `createAndStartRun(workflow, …)` writes `run.workspaceId = workflow.workspaceId`, plus `triggeredBy` (the user id for manual runs, otherwise `null`).
- `executeRun`'s `toolContext` carries `workspaceId`. `database-write` (and every sandbox store from `27`) writes it.
- **The tool cache key gains `workspaceId`** as its first segment: `toolCacheKey(workspaceId, toolType, toolConfig, input)`. Without this, tenant B gets a cache hit on tenant A's result (scope audit). `connectionId` is added in `25`.

### 6. Capability-token lookups stay global, on purpose

Some lookups aren't scoped by membership, because the token *is* the credential. Each keeps its current behaviour, and the run or record it creates inherits the workflow's `workspaceId`:

| Lookup | Where | Why it isn't scoped |
|---|---|---|
| `webhook.token` | `receiveWebhook` | The per-workflow secret token is the credential (`13`) |
| `shareToken` | `getShared` | The read-only link is the credential (`18`). A workspace setting can disable it (`23`). |
| Scheduler bootstrap | `bootstrapSchedules` | A system process, not a user request |

The global event endpoint is **not** in this list. `24` replaces it with a per-workspace one.

### 7. Workspace CRUD and switching

- Users can create more workspaces. The creator becomes `owner`.
- Rename and slug change are covered here (permissions in `23`). A slug change warns that event URLs (`24`) will change.
- **Deleting** a non-personal workspace cancels its active runs, unregisters its cron schedules, and then removes every document carrying its `workspaceId`: workflows, workflow versions (`30`), runs, templates, sandbox records (`27`), connections (`25`), API keys (`24`), memberships, invitations (`23`), comment threads, comments, watches and notifications (`29`), usage counters (`33`), and finally its audit events (`34`, the one sanctioned audit delete). The cascade is one list in `tenancy/deleteWorkspace.js`; each spec that adds a tenant collection adds it there, and `check:tenancy` fails if a model with a `workspaceId` path is missing from the list. Personal workspaces can't be deleted.
- **Client:** a workspace switcher in the header lists your workspaces with role badges and a "Create workspace" action. Switching goes to `/w/<slug>/dashboard`, not to the same page, because resource ids don't carry over between workspaces. The Builder's existing unsaved-changes guard (`useBlocker`) catches a switch mid-edit.

### 8. Migration of phase-1/2 data

An idempotent migration, `server/src/scripts/migrateWorkspaces.js`, runs **automatically on boot** before the scheduler starts, and is also available as `npm run migrate:workspaces`. It:

1. Creates a personal workspace and `owner` membership for every user who has none.
2. Sets `workspaceId` on every `Workflow`, `Run`, `Template` and `MockRecord` that lacks one, using its `ownerId` to find the user's personal workspace.
3. Renames `Workflow.ownerId` and `Template.ownerId` to `createdBy`. `Run.ownerId` becomes `triggeredBy` for `manual` runs and `null` otherwise. `MockRecord.ownerId` is dropped.
4. Leaves built-in templates (`ownerId: null`) with `workspaceId: null`, which keeps them visible to everyone.

It only touches documents where `workspaceId` doesn't exist yet, so it's safe to run again. It logs counts: `[migrate] 3 users, 12 workflows, 140 runs → personal workspaces`.

## Non-goals

- Roles, invitations and the permission matrix (spec `23`).
- Socket authentication and per-workspace events (spec `24`).
- A database per tenant, or a collection per tenant. It's one shared database, and every document carries `workspaceId`.
- Moving a workflow between workspaces. Duplicating it through a template (`15`) covers the need.
- Deleting user accounts.
- Custom domains per workspace.

## Data Model

**Workspace** (new)
```
{ _id, name: string, slug: string (unique), plan: 'free' | 'team' | 'enterprise' (default 'free'),
  personal: boolean, settings: { publicSharing: boolean (default true; used by 23) },
  createdBy: ObjectId<User>, createdAt, updatedAt }
```
Slug rules: lowercase `[a-z0-9-]`, 3–40 characters, no leading or trailing hyphen, unique. Reserved: `api`, `w`, `new`, `settings`, `admin`, `login`, `register`, `invite`, `shared`, `outbox`. It's generated from the name, with a random 4-character suffix on collision.

**Membership** (new)
```
{ _id, workspaceId, userId, role: 'owner' | 'admin' | 'editor' | 'viewer', createdAt }
unique index { workspaceId: 1, userId: 1 };  index { userId: 1 }
```

**User**: adds `name: string`.

**Workflow**: `ownerId` → `createdBy`, plus `workspaceId` (required). Index `{ workspaceId: 1, updatedAt: -1 }`.
**Run**: `ownerId` → `triggeredBy` (nullable), plus `workspaceId` (required). Index `{ workspaceId: 1, createdAt: -1 }`.
**Template**: `ownerId` → `createdBy`, plus `workspaceId` (`null` means built-in).
**MockRecord**: `ownerId` → `workspaceId`.

## API

New routes:

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/workspaces` | JWT | `[{ id, name, slug, role, personal, plan }]`: the caller's memberships |
| POST | `/api/workspaces` | JWT | `{ name }` → `201` workspace (caller is `owner`) |
| GET | `/api/workspaces/by-slug/:slug` | JWT | workspace + caller's `role`, or `404` if the caller isn't a member |
| PATCH | `/api/workspaces/:id` | JWT + `workspace:update` | `{ name?, slug? }` → workspace. `409` if the slug is taken, `400` if it's invalid or reserved. |
| DELETE | `/api/workspaces/:id` | JWT + `workspace:delete` | `{ confirmName }` must equal the name → `204`. `400` for a personal workspace. |

Changed routes:

- `POST /api/auth/register` accepts an optional `name`, creates the personal workspace, and returns `{ token, user, workspaces }`.
- `GET /api/auth/me` returns `{ id, email, name, workspaces: [...] }`.
- **Every existing tenant-scoped route** now runs `requireAuth → requireWorkspace` and filters by workspace: `/api/workflows/**`, `/api/runs/**`, `/api/templates/**`, `/api/analytics/**`. Their response shapes don't change, except that `ownerId` becomes `createdBy` (and `triggeredBy` on runs).
- `GET /api/tools` stays auth-only. The tool catalogue isn't tenant data.
- `GET /api/templates` returns built-ins plus **this workspace's** templates. Custom templates are now shared with teammates instead of private to one user.
- `GET /api/analytics/summary` aggregates over the current workspace.

## UI Behavior

- **Routing:** `/w/:slug/dashboard`, `/w/:slug/workflows/:id`, `/w/:slug/workflows/:id/runs`, `/w/:slug/runs/:runId`, `/w/:slug/templates`, `/w/:slug/analytics`. A `WorkspaceRoute` wrapper resolves the slug through `by-slug`, sets the current workspace in a new `workspaceStore`, and renders the page. The old un-prefixed routes (`/dashboard`, `/workflows/:id`, …) redirect to the same page in the last-used workspace. That's stored in `localStorage` (inside try/catch) and falls back to the personal workspace.
- **Unknown or foreign slug:** a "Workspace not found" page that lists your workspaces. It never redirects to someone else's data.
- **`apiClient`** adds `X-Workspace-Id` from `workspaceStore` to every request. On a `404 Workspace not found` (for example because you were just removed), it refreshes the workspace list and sends you to your personal workspace with a toast.
- **Header:** the workspace switcher sits left of the nav, showing the current workspace name, and a dropdown with workspaces, role badges and "Create workspace".
- **Registration form** gains an optional "Your name" field.

## Edge Cases & Error Handling

- **Right resource id, wrong workspace header** (for example a stale tab after switching) → 404. The client shows "This workflow isn't in <workspace>" with a link to the dashboard.
- **Malformed ObjectId** in a path or the header → 404, never 500.
- **Deleting a workspace while one of its runs is executing** → the delete cancels the run first (`requestCancel`, reason `user`), waits for in-flight nodes to drain, up to the run's own drain behaviour, and only then removes documents.
- **Deleting a workspace with enabled schedules** → every schedule is unregistered from the in-process cron registry *before* the workflows are deleted, so no tick fires against a deleted workflow.
- **Concurrent slug claims** → the unique index decides. The loser gets a `409`, and auto-generation retries with a new suffix.
- **A workspace with zero owners** can't happen here, because only `23` changes roles and it guards the last owner.
- **The migration runs while the old client is open** → the old client's requests fail with a 400 (missing header). A hard refresh loads the new client. That's acceptable for a local deployment.

## Acceptance Criteria

- [ ] Registering creates a user, a personal workspace and an `owner` membership. `/me` lists it.
- [ ] A user in two workspaces sees only the current workspace's workflows, runs, templates and analytics, and the switcher changes all four.
- [ ] Every tenant-scoped route, called with a valid resource id belonging to another workspace, returns 404 (the full route inventory is in `check:tenancy`).
- [ ] Every list route (`GET /api/workflows`, `/api/workflows/:id/runs`, `/api/templates`, `/api/analytics/summary`) never includes another workspace's data.
- [ ] A missing `X-Workspace-Id` returns 400. A foreign or malformed one returns 404.
- [ ] Two workspaces running identical cacheable tool calls get **no** cross-workspace cache hit.
- [ ] Webhook-, schedule- and share-token paths still work, and create runs in the workflow's own workspace.
- [ ] `database-write` records carry the run's `workspaceId`.
- [ ] Running the migration twice on a phase-2 database gives the same result as running it once, and every phase-2 workflow still opens and runs.
- [ ] Deleting a workspace stops its schedules and removes all its documents. A personal workspace can't be deleted.
- [ ] `/w/<foreign-slug>/…` renders "Workspace not found" and shows no data.
- [ ] **Static scan:** no controller calls `findById`, `find`, `findOne` or `aggregate` on `Workflow`, `Run`, `Template` or `MockRecord` without going through `tenancy/scoped.js`, except lines marked `// tenancy: capability lookup`.
- [ ] All six phase-2 check suites pass after being updated to send `X-Workspace-Id`.

`npm run check:tenancy` (in `server/`) covers these against a running server. It's extended by `23` and `24`.
