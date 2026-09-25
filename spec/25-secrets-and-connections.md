# Spec: Secrets & Connections

**Status:** Phase 3 — Tier 1
**Milestone:** M4
**Depends on:** `22-workspaces-multitenancy.md`, `23-roles-and-invitations.md`
**Revises:** `08-in-memory-cache.md` (cache key gains `connectionId`), `21-extended-tool-catalog.md` (its "no credential storage" non-goal no longer applies)

## Summary

Adds a per-workspace **credential vault**. A **Connection** is a named, stored set of credentials and settings for one integration, for example "Acme Slack #alerts" or "GitHub (bot account)". Tool nodes pick a connection instead of carrying credentials in their own config. Credentials are encrypted at rest with AES-256-GCM. Over the API they're write-only: never returned, only shown as masked hints. They're decrypted only inside the engine at the moment a node runs, and scrubbed from every log line and output the run produces.

This is what makes `C2` safe. Live mode means real tokens, and real tokens can't live in plain node config that `18`'s share links, `15`'s templates and `28`'s collaborators all read.

## Goals

### 1. The vault, `server/src/secrets/vault.js`

- `encrypt(plainObject, aad)` returns `{ iv, tag, ciphertext }`, all base64. It uses a random 12-byte IV per encryption, AES-256-GCM, and JSON-serializes the input.
- `decrypt({ iv, tag, ciphertext }, aad)` returns the plain object. On a bad tag or wrong key it throws `VaultError`.
- **Key:** `SECRETS_MASTER_KEY`, 32 bytes, base64-encoded. It's read once in `config/env.js`. It's **required**: boot fails with `SECRETS_MASTER_KEY must be 32 bytes of base64 — generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. `.env.example` carries a placeholder and that command, never a usable key.
- **Additional authenticated data** is bound to `workspaceId:connectionId`. A ciphertext copied into another connection or another workspace fails to decrypt. The connection's `_id` is generated before the first encryption for exactly this reason.
- It uses nothing but `node:crypto`. No new dependency.

### 2. Connections

- A connection belongs to one workspace and one integration (its manifest `id` from `26`). Its credentials are validated against that manifest's `auth.fields`: required fields must be present, unknown keys are rejected, and fields marked `secret: true` are encrypted. Everything else goes in plain `config`.
- **`mode: 'live' | 'sandbox'`** is per connection, and feeds `26`'s mode rule. Switching a connection to sandbox is how you rehearse a workflow against Slack without posting anything. It defaults to `live` when the integration has any live action, and `sandbox` otherwise.
- **`credentialHints`**: for each secret field, a masked hint stored next to the ciphertext. That's `••••` plus the last 4 characters for values of 12 or more characters, and just `••••` otherwise. The hint is how the UI says "a token is set" without ever holding the token.
- **Test connection:** `POST /:id/test` calls the manifest's optional `test(ctx)` (added to the manifest contract in `26`). The result is saved as `status: 'ok' | 'error'`, `lastTestedAt` and `lastError`. A connection in sandbox mode always tests `ok`.
- **The virtual sandbox connection.** `connectionId: 'sandbox'` is a reserved value, not a database document. It resolves to `{ id: 'sandbox', mode: 'sandbox', credentials: {}, config: {} }` for any integration. That gives every node picker a "Sandbox (no account)" option, including integrations like `http` that need no credentials and would otherwise always run live under `26`'s rule.

### 3. Resolving credentials at execution time

`resolveConnection(workspaceId, connectionId, integration)` in `server/src/secrets/connections.js`:

1. returns `null` for `connectionId == null`, and the virtual connection for `'sandbox'`;
2. loads with `{ _id, workspaceId }`, so a node in workspace A that references B's connection id gets **not found**. That's a `PermanentFailure` `Connection not found`, not a retry;
3. throws `PermanentFailure` `Connection "<name>" is for <x>, not <integration>` when the integration doesn't match;
4. decrypts, and returns `{ id, name, mode, config, credentials }`.

Plaintext credentials exist only in the returned object, which is handed straight to the action (`26`'s `ctx.connection`). They're never cached, never stored on the node result, and never emitted over a socket. Decrypting per job is cheap next to the network call it enables.

### 4. Redaction

Every execution that resolved a connection builds a **redactor** from the decrypted secret values (strings of 4 or more characters). The engine runs it over:

- every log line before it's persisted or emitted as `node:log`,
- the node's `output`, walked deeply, before it's persisted, emitted, or passed downstream,
- error messages, since a live API echoing back an `Authorization` header is a real way leaks happen.

Matches become `••••`. The redactor also scrubs the `Authorization`, `X-API-Key` and `Cookie` values of request headers wherever an action puts request metadata in its output. Redaction runs **before** the output enters the cache, so a cached result can't carry a secret either.

### 5. Cache key

`toolCacheKey` (already workspace-prefixed by `22`) becomes a stable-JSON key over `{ workspaceId, integration, action, connectionId, params, input }`. "Stable" means sorted object keys. Today's `JSON.stringify` in `TTLCache.js` is key-order-sensitive, so two equal configs saved in different key orders miss each other. Two connections to different Slack workspaces therefore never share a cached result, even with identical params. (Only read-only actions are cacheable at all; `26`.)

### 6. Audit

Every mutation calls `audit(req, action, { type: 'connection', id }, meta)` (`34`). The actions are `connection.created`, `connection.updated`, `connection.credentials_changed`, `connection.mode_changed`, `connection.tested` and `connection.deleted`. `meta` holds `{ integration, name, mode }` and **never** credential values or hints. Until `34` lands, `audit()` is a no-op stub, so the calls are already in place.

## Non-goals

- OAuth flows (phase-3 non-goal). Credentials are pasted API keys, tokens and webhook URLs.
- Key rotation for `SECRETS_MASTER_KEY`. Losing or changing the key makes existing connections undecryptable, and they must be re-entered (see Edge Cases). A re-encrypt script is future work.
- A KMS, HSM or any external secret store (no external infra).
- Sharing connections across workspaces. A connection belongs to exactly one.
- Per-user connections ("use my own GitHub token"). Connections belong to the workspace.
- Reading plaintext back out, even for owners. There's no "reveal" button.

## Data Model

**Connection** (new)
```
{ _id, workspaceId, integration: string, name: string,
  mode: 'live' | 'sandbox',
  credentials: { iv, tag, ciphertext } | null,     // AES-256-GCM, AAD = `${workspaceId}:${_id}`
  credentialHints: { [field]: '••••1234' },
  config: Mixed,                                    // non-secret manifest fields, e.g. default channel
  inboundToken: string | null,                      // used by 27's inbound webhooks
  status: 'untested' | 'ok' | 'error', lastTestedAt: Date | null, lastError: string | null,
  createdBy: ObjectId<User>, createdAt, updatedAt }
index { workspaceId: 1, integration: 1 };  unique { workspaceId: 1, integration: 1, name: 1 }
```

**Tool node config** references it as `connectionId: ObjectId | 'sandbox' | null` (the shape is defined in `26`).

## API

All routes run `requireAuth → requireWorkspace` (`22`). "Returned connection" always means the public shape `{ id, integration, name, mode, credentialHints, config, status, lastTestedAt, lastError, inboundUrl?, createdBy, createdAt, updatedAt }`, and **never** `credentials`.

| Method | Path | Permission | Body / Response |
|---|---|---|---|
| GET | `/api/connections?integration=slack` | `workflow:read` | list. Viewers get names and status only (hints and config are stripped), so a read-only config panel can still show which connection a node uses. |
| POST | `/api/connections` | `connections:manage` | `{ integration, name, mode?, credentials, config? }` → `201` connection |
| GET | `/api/connections/:id` | `connections:use` | connection |
| PATCH | `/api/connections/:id` | `connections:manage` | `{ name?, mode?, config?, credentials? }` → connection |
| POST | `/api/connections/:id/test` | `connections:use` | → `{ status, lastError, detail? }` |
| GET | `/api/connections/:id/usage` | `connections:use` | `[{ workflowId, workflowName, nodeIds }]` |
| DELETE | `/api/connections/:id?force=true` | `connections:manage` | `204`, or `409 { usage }` if referenced and `force` isn't set |

- **`PATCH` merges credentials.** A field that's present replaces the stored value, an omitted field keeps it, and `null` clears it. That's how "leave blank to keep the current token" works without the client ever holding the token. Any credential change resets `status` to `untested`.
- **Saving a workflow** (`PUT /api/workflows/:id`) validates every node's `connectionId`: it must be `null`, `'sandbox'`, or a connection **in this workspace** for the node's integration. Anything else gets a 400 `Unknown connection for node "<label>"`. `28`'s collaboration ops must apply the same check.
- **Templates:** saving a workflow as a template (`15`) sets every `connectionId` to `null`. Connections don't travel, and a template used later shows "needs a connection" hints instead.

## UI Behavior

- **Connection form** (a dialog, used from the integration detail page in `27` and inline from the Node Config Panel):
  - fields are rendered from the manifest's `auth.fields` through the existing generic renderer (`ToolConfigFields`); secret fields render as password inputs;
  - when editing, a secret field shows its hint as the placeholder ("•••• 1a2b — leave blank to keep") and starts empty;
  - there's a mode toggle, **Live / Sandbox**. Live is disabled with an explanation when the integration has no live actions, or when the server reports `liveEnabled: false` ("Live calls are disabled on this server");
  - "Save" and "Save & test" buttons; the test result shows inline.
- **Connections list** at `/w/:slug/connections`: every connection in the workspace with integration icon, name, mode badge, status dot, last tested and created by. Rows open the edit dialog. Delete shows the usage list and requires typing the name when it's in use.
- **Node Config Panel:** under the action picker (`26`), a **Connection** select filtered to the node's integration. Options are this workspace's connections (with a status dot), **Sandbox (no account)**, **None** (shown only for `auth.type: 'none'` integrations, labelled "None — live"), and **+ New connection…** (only with `connections:manage`; editors without it see "Ask an admin to add a <Slack> connection"). Viewers see the selected connection's name, read-only.
- A node whose connection has `status: 'error'` shows a warning dot on the canvas, and in `20`'s validation panel.

## Edge Cases & Error Handling

- **`SECRETS_MASTER_KEY` changed or lost** → decrypting fails with `VaultError`. The connection's status becomes `error` ("Credentials can't be decrypted — re-enter them"), and nodes using it fail as `PermanentFailure` with the same message. Nothing crashes, and no other connection is affected.
- **A connection is deleted while it's referenced** → without `force` the request gets 409 with the usage list. With `force`, the referencing nodes keep a dangling id, the validation panel flags them, and runs fail them with `Connection not found`. Published versions (`30`) are included in usage.
- **Connection switched to sandbox mid-run** → nodes resolve their connection when they execute, so nodes that haven't started yet run in sandbox. The run log records each node's actual mode (`26`).
- **Credential values in node params** (someone pastes a token into an HTTP header param instead of a connection) → not blocked, but the validation panel warns when a param value looks like a known token format (`xoxb-`, `ghp_`, `github_pat_`, `sk_live_`, `sk_test_`, a `Bearer ` prefix): "Store this in a connection so it's encrypted and redacted."
- **Duplicate names** within (workspace, integration) → 409.
- **A test call that hangs** → it goes through `safeRequest`'s timeout (`27`) and records `error: timed out`.
- **Viewer calls `GET /api/connections/:id`** → 403. Viewers only get the stripped list.

## Acceptance Criteria

- [ ] Creating a connection stores only ciphertext. The secret value doesn't appear anywhere in the `connections` collection (checked by scanning the raw document).
- [ ] No API response ever contains a secret value: create, read, list, update, test, usage, workflow GET, run GET, and shared view are all scanned for the literal secret.
- [ ] A ciphertext copied into a different connection document fails to decrypt (AAD binding).
- [ ] Boot fails with the generate-a-key instructions when `SECRETS_MASTER_KEY` is missing or isn't 32 bytes.
- [ ] `PATCH` without a secret field keeps it. `PATCH` with `null` clears it.
- [ ] A live action whose response echoes the token has that token replaced by `••••` in the persisted output, the `node:log` stream, and the cache.
- [ ] A node referencing another workspace's connection id is rejected on save (400) and fails at run time (`Connection not found`, one attempt).
- [ ] Two connections with identical params never share a cache entry.
- [ ] `connectionId: 'sandbox'` forces sandbox for any integration, including `http`.
- [ ] Deleting a connection that's in use returns 409 with usage. `force` deletes it and the validation panel flags the nodes.
- [ ] Viewers can see connection names but not hints or config, and can't create, test or delete.
- [ ] Saving as a template nulls every `connectionId`.

`npm run check:integrations` (in `server/`) covers these, with `INTEGRATIONS_LIVE=false`.
