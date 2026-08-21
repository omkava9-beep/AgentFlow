# Plan: Extended Tool Catalog & External Event Trigger

**Spec:** [`spec/21-extended-tool-catalog.md`](../spec/21-extended-tool-catalog.md)
**Depends on:** `05-agent-tool-providers`, `03-node-configuration-panel`, `13-webhook-trigger`

## Backend Tasks

### Declarative config schemas

- [ ] Add a `configSchema` array to every `ToolHandler` in `tools/toolHandlers.js` (including the three existing ones) — field descriptors `{ key, label, type, required?, default?, placeholder?, options? }` with `type` ∈ `text | textarea | number | select | boolean`
- [ ] Add a `description` to each handler
- [ ] `ToolRegistry.list()` → `{ type, label, description, configSchema }`; `GET /api/tools` returns it
- [ ] Read tool field values from `config.toolConfig` (keeping them clear of the reserved `label` / `toolType` / `mockOverrides` keys)
- [ ] Small `{{input.path}}` interpolation helper — unresolved references render empty and add a log line, they don't fail the node

### Four new mocked handlers

All four wrap `withMockBehavior()` so they inherit latency, `17`'s failure injection, and `07`/`19`'s retry for free.

- [ ] `send-email` — fields `to`, `subject`, `body`; output `{ delivered, to, messageId }`
- [ ] `slack-message` — fields `channel`, `text`; output `{ posted, channel, ts }`
- [ ] `http-request` — fields `url`, `method` (select), `body`; output `{ status: 200, url, method, body }`. **Stays mocked deliberately** — real outbound HTTP from a user-supplied URL is an SSRF primitive, adds a network dependency to demo runs, and breaks `CLAUDE.md`'s no-external-infra rule. Note this in a code comment so it doesn't read as unfinished
- [ ] `database-write` — fields `collection`, `document` (JSON textarea); inserts a real `MockRecord` doc scoped to `ownerId` + `runId`; output `{ inserted, collection, id }`
- [ ] `database-write` malformed JSON → reject with `PermanentToolFailure` (from `19`) so it fails immediately instead of burning all retry attempts on input that will never parse
- [ ] `models/MockRecord.js` — `{ ownerId, runId, collection, document, createdAt }`

### External Event trigger

- [ ] `models/Workflow.js` — add `eventTrigger: { eventName, enabled }`
- [ ] `PUT /api/workflows/:id/event-trigger`, `DELETE /api/workflows/:id/event-trigger`
- [ ] `routes/events.js` + `POST /api/events/:eventName`, mounted **outside** auth middleware (same pattern as `routes/hooks.js` and `routes/shared.js`); looks workflows up by `eventTrigger.eventName` + `enabled`
- [ ] Fan out to **every** matching workflow via the shared `createAndStartRun` from `12` — the fan-out is what distinguishes an event from `13`'s one-token-one-workflow webhook
- [ ] Zero subscribers → `202 { triggered: [] }`, not `404`; a workflow with a run already in progress is skipped but doesn't block the others
- [ ] `models/Run.js` — add `trigger: 'manual' | 'schedule' | 'webhook' | 'event'`, set by each entry point (coordinate with `12` and `13`)

## Frontend Tasks

- [ ] `components/NodeConfigPanel.jsx` — render tool fields generically from `configSchema`; no per-type branching. Changing `toolType` clears the previous type's `toolConfig`
- [ ] Unknown stored `toolType` → show the raw value with an "unknown tool type" warning and **preserve** it; resetting it to empty would destroy the user's config
- [ ] `components/TriggerPanel.jsx` — all four types live; External Event card gets an event-name input, enable toggle, and a copyable `curl` example (a trigger nobody can figure out how to fire isn't demoable)
- [ ] `api/workflows.js` — event-trigger get/set calls
- [ ] Run Monitor header — show the run's `trigger` origin
- [ ] Delete `ACTION_TYPES` from `client/src/comingSoonCatalog.js` and every import of it; the tool dropdown is driven solely by `GET /api/tools`
- [ ] Flip all `TRIGGER_TYPES` entries to `live: true`

## Verification

- [ ] Each of the seven tool types renders its own fields, driven entirely by the API with no per-type branching
- [ ] Adding an eighth handler to `TOOL_HANDLERS` surfaces it with working fields and **zero** client changes
- [ ] `send-email` / `slack-message` / `http-request` outputs reflect both config and upstream input
- [ ] `database-write` inserts a real `MockRecord`, verifiable in MongoDB, tagged with the writing `runId`
- [ ] `database-write` with invalid JSON fails immediately without consuming all attempts
- [ ] All four new tools honour a `failureRate` override and retry per `17`/`19`
- [ ] Two workflows on the same event name both run from one `POST /api/events/:name`
- [ ] `POST /api/events/:name` with no subscribers → `202`, empty list
- [ ] `grep -r ACTION_TYPES client/src` returns nothing
- [ ] Run Monitor shows the trigger that started each run
