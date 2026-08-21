# Plan: Extended Tool Catalog & External Event Trigger

**Spec:** [`spec/21-extended-tool-catalog.md`](../spec/21-extended-tool-catalog.md)
**Depends on:** `05-agent-tool-providers`, `03-node-configuration-panel`, `13-webhook-trigger`

> **Status: complete.** The event-trigger half landed with step 5; this step did the tool
> catalog. Verified by 32 handler checks (interpolation, permanent vs simulated failures, a
> real `MockRecord` insert tagged with its `runId`, per-tool cacheability), 15 browser checks
> on the generic form, and 8 new validator checks. The headline claim was tested directly:
> a temporary eighth tool was added to `TOOL_HANDLERS` **server-side only** and appeared in
> the dropdown with all five widget types, its description, its `select` default and
> required-field validation — then removed again.
>
> Three things beyond the task list, now in `spec/21`:
> - The TTL cache key had to include `toolConfig`. Keyed on `toolType` + input alone, two
>   `send-email` nodes with different recipients and the same upstream input would collide.
> - Side-effecting tools opt out of caching (`cacheable: false`). Caching a "send" means the
>   second one silently doesn't happen.
> - `MockRecord` stores `collectionName`, not `collection` — the latter is a reserved Mongoose
>   schema path that shadows `Document#collection`, and Mongoose warns it may break internals.
>   The tool's config field and output still read `collection`.

## Backend Tasks

### Declarative config schemas

- [x] Add a `configSchema` array to every `ToolHandler` in `tools/toolHandlers.js` (including the three existing ones) — field descriptors `{ key, label, type, required?, default?, placeholder?, options? }` with `type` ∈ `text | textarea | number | select | boolean`
- [x] Add a `description` to each handler
- [x] `ToolRegistry.list()` → `{ type, label, description, configSchema }`; `GET /api/tools` returns it
- [x] Read tool field values from `config.toolConfig` (keeping them clear of the reserved `label` / `toolType` / `mockOverrides` keys)
- [x] Small `{{input.path}}` interpolation helper — unresolved references render empty and add a log line, they don't fail the node

### Four new mocked handlers

All four wrap `withMockBehavior()` so they inherit latency, `17`'s failure injection, and `07`/`19`'s retry for free.

- [x] `send-email` — fields `to`, `subject`, `body`; output `{ delivered, to, messageId }`
- [x] `slack-message` — fields `channel`, `text`; output `{ posted, channel, ts }`
- [x] `http-request` — fields `url`, `method` (select), `body`; output `{ status: 200, url, method, body }`. **Stays mocked deliberately** — real outbound HTTP from a user-supplied URL is an SSRF primitive, adds a network dependency to demo runs, and breaks `CLAUDE.md`'s no-external-infra rule. Note this in a code comment so it doesn't read as unfinished
- [x] `database-write` — fields `collection`, `document` (JSON textarea); inserts a real `MockRecord` doc scoped to `ownerId` + `runId`; output `{ inserted, collection, id }`
- [x] `database-write` malformed JSON → reject with `PermanentToolFailure` (from `19`) so it fails immediately instead of burning all retry attempts on input that will never parse
- [x] `models/MockRecord.js` — `{ ownerId, runId, collection, document, createdAt }`

### External Event trigger

- [x] `models/Workflow.js` — add `eventTrigger: { eventName, enabled }`
- [x] `PUT /api/workflows/:id/event-trigger`, `DELETE /api/workflows/:id/event-trigger`
- [x] `routes/events.js` + `POST /api/events/:eventName`, mounted **outside** auth middleware (same pattern as `routes/hooks.js` and `routes/shared.js`); looks workflows up by `eventTrigger.eventName` + `enabled`
- [x] Fan out to **every** matching workflow via the shared `createAndStartRun` from `12` — the fan-out is what distinguishes an event from `13`'s one-token-one-workflow webhook
- [x] Zero subscribers → `202 { triggered: [] }`, not `404`; a workflow with a run already in progress is skipped but doesn't block the others
- [x] `models/Run.js` — add `trigger: 'manual' | 'schedule' | 'webhook' | 'event'`, set by each entry point (coordinate with `12` and `13`)

## Frontend Tasks

- [x] `components/NodeConfigPanel.jsx` — render tool fields generically from `configSchema`; no per-type branching. Changing `toolType` clears the previous type's `toolConfig`
- [x] Unknown stored `toolType` → show the raw value with an "unknown tool type" warning and **preserve** it; resetting it to empty would destroy the user's config
- [x] `components/TriggerPanel.jsx` — all four types live; External Event card gets an event-name input, enable toggle, and a copyable `curl` example (a trigger nobody can figure out how to fire isn't demoable)
- [x] `api/workflows.js` — event-trigger get/set calls
- [x] Run Monitor header — show the run's `trigger` origin
- [x] Delete `ACTION_TYPES` from `client/src/comingSoonCatalog.js` and every import of it; the tool dropdown is driven solely by `GET /api/tools`
- [x] Flip all `TRIGGER_TYPES` entries to `live: true`

## Verification

- [x] Each of the seven tool types renders its own fields, driven entirely by the API with no per-type branching
- [x] Adding an eighth handler to `TOOL_HANDLERS` surfaces it with working fields and **zero** client changes
- [x] `send-email` / `slack-message` / `http-request` outputs reflect both config and upstream input
- [x] `database-write` inserts a real `MockRecord`, verifiable in MongoDB, tagged with the writing `runId`
- [x] `database-write` with invalid JSON fails immediately without consuming all attempts
- [x] All four new tools honour a `failureRate` override and retry per `17`/`19`
- [x] Two workflows on the same event name both run from one `POST /api/events/:name`
- [x] `POST /api/events/:name` with no subscribers → `202`, empty list
- [x] `grep -r ACTION_TYPES client/src` returns nothing
- [x] Run Monitor shows the trigger that started each run
