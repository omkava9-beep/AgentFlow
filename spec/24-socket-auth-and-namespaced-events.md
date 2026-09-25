# Spec: Socket Auth, Workspace API Keys & Namespaced Events

**Status:** Phase 3 — Tier 1
**Milestone:** M4
**Depends on:** `22-workspaces-multitenancy.md`, `23-roles-and-invitations.md`
**Revises:** `09-realtime-monitoring.md` (auth, rooms, queue stats), `21-extended-tool-catalog.md` (event endpoint), `13-webhook-trigger.md` (adds the `api` trigger alongside it)

## Summary

Closes the two cross-tenant holes left in the real-time and external-trigger layers:

1. **Socket.io has no authentication.** Any connection can `run:subscribe` to any run id and stream another tenant's node outputs live, and `queue:stats` is broadcast to everyone. This spec adds a JWT handshake, authorizes every room join against membership, evicts sockets when access is revoked, and scopes queue stats per workspace.
2. **Event names are one global namespace.** `POST /api/events/:name` fires every tenant's subscribers. Events move to `POST /api/w/:slug/events/:name`, authenticated by a **workspace API key**. The same keys power a small public REST API for starting and reading runs, which is the "real product" way external systems call in.

## Goals

### 1. Authenticated socket connections

- The client connects with `io(url, { auth: { token } })`. Server `io.use()` middleware verifies the JWT and sets `socket.data.userId` and `socket.data.tokenExp`. A missing or invalid token rejects the connection with `connect_error` `unauthorized`. The client treats that exactly like an HTTP 401: it logs out and redirects to `/login`.
- On connect, the socket automatically joins **`user:<userId>`**, the channel `23` uses for `workspace:role_changed` and `workspace:access_revoked`, and `29` for notifications.
- **Token expiry mid-connection:** every subscribe handler checks `socket.data.tokenExp`. After expiry it rejects with `unauthorized`, and the client re-authenticates. An idle authorized connection isn't actively killed at expiry, because it can't receive anything new without subscribing.

### 2. Every room join is authorized

There's one function, `authorizeRoom(socket, kind, id)`, in `server/src/sockets/rooms.js`. Every subscribe goes through it:

| Room | Join event | Rule |
|---|---|---|
| `user:<id>` | automatic | Only your own |
| `workspace:<id>` | `workspace:subscribe { workspaceId }` | Membership exists (any role) |
| `run:<id>` | `run:subscribe { runId }` | Run exists **and** the caller is a member of `run.workspaceId` |
| `workflow:<id>` | `workflow:subscribe { workflowId }` (used by `28`) | Workflow exists **and** the caller is a member of `workflow.workspaceId` |

- Joins use Socket.io **acknowledgements**: the handler replies `{ ok: true }` or `{ ok: false, error: 'not_found' }`. "Not a member" and "doesn't exist" give the same `not_found`, following `22`'s 404 rule.
- Each socket keeps a `socket.data.rooms` map of `room → workspaceId`, so eviction knows which rooms belong to which workspace.
- The client **re-subscribes on every `connect`**, since rooms don't survive a reconnect. That keeps the existing resync-on-reconnect behaviour of `useRunSocket`.

### 3. Eviction on revocation

`evictFromWorkspace(userId, workspaceId)` is called by `23` when a member is removed or leaves. It:

1. finds every socket of that user (through the `user:<id>` room),
2. makes each socket leave every room whose `socket.data.rooms` entry maps to that workspace, and
3. emits `workspace:access_revoked { workspaceId }` to `user:<id>`.

Role changes don't evict, since viewers can still read. `23` emits `workspace:role_changed` instead. `28` adds its own reaction (a demoted editor drops their soft locks).

### 4. One shared client socket

Right now each `useRunSocket` opens its own connection. With workspace, user, run and (in `28`) workflow rooms all in use, the client moves to **one socket per session**, in `client/src/realtime/socket.js`:

- It's created after login with the JWT, and disconnected on logout.
- `subscribe(kind, id)` / `unsubscribe(kind, id)` helpers keep a reference-counted set of desired rooms and replay them on reconnect.
- `useRunSocket` is refactored onto it. Its public return shape (`{ run, logs, queueStats }`) doesn't change.

### 5. Queue stats per workspace

- `queue.enqueue(job, { …, meta: { workspaceId } })`: the engine tags every job with its run's workspace.
- `queue:stats` is emitted **to `workspace:<id>`** with that workspace's own `{ active, queued }` and the shared `concurrency`. It's no longer broadcast.
- It's only emitted to workspaces whose counts actually changed, so one tenant's activity doesn't generate events for everyone else.
- `33` replaces the FIFO queue with fair scheduling. This event shape is designed to survive that change (`33` adds `cap`).

### 6. Workspace API keys

- **Format:** `af_` + 40 random base62 characters. It's shown **once** at creation. Stored as `keyHash` (SHA-256) plus a display `prefix` (`af_` + first 8 characters).
  - SHA-256 rather than bcrypt is deliberate: keys are high-entropy random strings, not guessable passwords, and every API call looks one up. That makes a fast hash the right choice.
- **Scopes:** `events:publish`, `runs:create`, `runs:read`. A key has one or more.
- **Auth:** `Authorization: Bearer af_…` (also accepted as `X-API-Key`). The `requireApiKey(scope)` middleware:
  1. hashes the key and looks it up (skipping revoked keys),
  2. requires the key's workspace to match the `:slug` in the path, returning **404** otherwise (an Acme key can't touch Globex, and you can't tell whether Globex exists),
  3. requires the scope, returning **403** otherwise,
  4. sets `req.workspaceId` and `req.apiKey`, and updates `lastUsedAt` at most once a minute.
- Managed under Settings → API keys by `apiKeys:manage` (owner or admin).

### 7. Namespaced events and the public API

| Method | Path | Scope | Behaviour |
|---|---|---|---|
| POST | `/api/w/:slug/events/:eventName` | `events:publish` | Fans out to **this workspace's** enabled subscribers only. Same `202 { triggered: [runId…] }` contract as `21`. |
| POST | `/api/w/:slug/workflows/:id/runs` | `runs:create` | Starts a run with the JSON body as input. `202 { runId }`. It's the manual-run path with `trigger: 'api'`. |
| GET | `/api/w/:slug/runs/:id` | `runs:read` | Run status, timings and per-node status. Node **outputs** are included only if the workflow belongs to the key's workspace, which it always does after the slug check. |

- Every run path goes through `createAndStartRun()`. Run gains `trigger: 'api'` and `apiKeyId` (for `34`'s audit log).
- **The old `POST /api/events/:eventName` returns `410 Gone`**, with `{ error, newUrl: '/api/w/<slug>/events/<name>' }` as a hint. It's not silently kept: a global unauthenticated fan-out is exactly the bug being fixed.
- Event names must match `^[A-Za-z0-9._:-]{1,100}$`. Anything else gets a 400.
- Per-workflow webhook tokens (`13`) are unchanged. They're already per-workflow capabilities.

## Non-goals

- Rate limiting API keys (still out of scope per `CLAUDE.md`).
- Key expiry schedules or automatic rotation. Keys are revoked by hand.
- Fine-grained keys limited to specific workflows. Scopes apply to the whole workspace.
- Socket.io namespaces or adapters for multiple processes. It's one process with rooms.
- A public API beyond the three routes above. Full CRUD over the public API isn't needed for the demo or the brief.

## Data Model

**ApiKey** (new)
```
{ _id, workspaceId, name: string, prefix: string, keyHash: string (unique),
  scopes: ('events:publish' | 'runs:create' | 'runs:read')[],
  createdBy: ObjectId<User>, lastUsedAt: Date | null, revokedAt: Date | null, createdAt }
```

**Run**: `trigger` gains `'api'`, plus `apiKeyId: ObjectId | null`.

## API (management)

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/workspaces/:id/api-keys` | `apiKeys:manage` | `[{ id, name, prefix, scopes, createdBy, lastUsedAt, revokedAt, createdAt }]` (never the key or its hash) |
| POST | `/api/workspaces/:id/api-keys` | `apiKeys:manage` | `{ name, scopes }` → `201 { apiKey, key }`. This is the only time `key` is ever returned. |
| DELETE | `/api/workspaces/:id/api-keys/:keyId` | `apiKeys:manage` | `204` (sets `revokedAt`, which takes effect on the next request) |

## Socket contract

| Event | Direction | Payload |
|---|---|---|
| `workspace:subscribe` / `workspace:unsubscribe` | client → server | `{ workspaceId }`, ack `{ ok, error? }` |
| `run:subscribe` / `run:unsubscribe` | client → server | `{ runId }`, ack `{ ok, error? }` (now authorized) |
| `workflow:subscribe` / `workflow:unsubscribe` | client → server | `{ workflowId }`, ack `{ ok, error? }` (room reserved for `28`) |
| `queue:stats` | server → `workspace:<id>` | `{ workspaceId, active, queued, concurrency }` |
| `workspace:role_changed` | server → `user:<id>` | `{ workspaceId, role, permissions }` (emitted by `23`) |
| `workspace:access_revoked` | server → `user:<id>` | `{ workspaceId }` |

The existing `run:started`, `node:update`, `node:log`, `run:cancelled` and `run:completed` don't change. They're still emitted to `run:<id>`, which is now authorized.

## UI Behavior

- **Settings → API keys** tab (owner and admin only): a table with name, prefix, scopes, created by, last used and a revoke button. "Create key" opens a dialog with name and scope checkboxes, then a **show-once** modal with a copy button and "You won't see this key again".
- **Trigger panel, External Event card:** the `curl` example becomes:
  ```
  curl -X POST <PUBLIC_BASE_URL>/api/w/<slug>/events/<name> \
    -H "Authorization: Bearer <YOUR_API_KEY>" -H "Content-Type: application/json" -d '{}'
  ```
  It links to the API keys tab, and warns that renaming the workspace slug changes this URL.
- **Run monitor and history:** the trigger badge gains **API** (showing the key's name on hover).
- **Queue indicator** now shows this workspace's own active and queued counts.
- **Lost auth:** a `connect_error: unauthorized` logs the user out, the same way an HTTP 401 does.

## Edge Cases & Error Handling

- **Subscribing to a run in a workspace you were just removed from** → ack `not_found`. The monitor shows "You no longer have access to this run".
- **A stale tab reconnects after eviction** → the re-subscribe is rejected, and the client already received `workspace:access_revoked`, or does on its next REST call (`22`'s 404 handling).
- **Duplicate subscriptions** (two components watching the same run) → the client reference-counts, so there's one server join and one leave when the last watcher unmounts.
- **Slug renamed** → an API call to the old slug returns 404. No redirect from old slugs is kept, and the UI warning in `22` says so.
- **Revoked key still in use** → 401 `Invalid API key`. Revoked and unknown keys look the same.
- **Key used on a different workspace's slug** → 404, not 403, so it doesn't confirm the other workspace exists.
- **API run request on a workflow that's already running** → `409`, matching `createAndStartRun`'s existing guard and the webhook endpoint.
- **Event publish with zero subscribers** → `202 { triggered: [] }`, unchanged from `21`.

## Acceptance Criteria

- [ ] A socket connection without a valid JWT is refused.
- [ ] A signed-in socket can't join a `run:`, `workflow:` or `workspace:` room belonging to another workspace (ack `not_found`), and receives none of its events.
- [ ] `queue:stats` for workspace A is never received by a socket that's only in workspace B.
- [ ] Removing a member evicts their open sockets from that workspace's rooms immediately, and their monitor stops receiving events.
- [ ] One client socket per session. Watching two runs in two tabs of the app still works, and reconnects restore every subscription.
- [ ] `POST /api/w/:slug/events/:name` with a valid key fires only that workspace's subscribers. Two workspaces subscribed to the same name don't fire each other.
- [ ] A key used with another workspace's slug returns 404. A missing scope returns 403. A revoked key returns 401.
- [ ] `POST /api/events/:name` returns 410 with the new URL hint.
- [ ] A run started with `runs:create` appears in history with the **API** trigger badge, and `GET /api/w/:slug/runs/:id` reports its progress.
- [ ] Keys are stored hashed, and the plaintext key appears in exactly one response: the create call.
- [ ] `check:triggers` from phase 2 is updated to the new event URL and passes.

`npm run check:tenancy` (extended) covers the socket and API-key criteria with two to three socket.io clients against a running server.
