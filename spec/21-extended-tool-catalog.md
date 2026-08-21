# Spec: Extended Tool Catalog & External Event Trigger

**Status:** Phase 2 extension
**Milestone:** M3
**Depends on:** `05-agent-tool-providers.md`, `03-node-configuration-panel.md`, `13-webhook-trigger.md`

## Summary

Flips the four gated entries in `comingSoonCatalog.js` (`send-email`, `slack-message`, `http-request`, `database-write`) into real registered tools, and the gated `event` trigger into a working named-event dispatch. Along the way it replaces the config panel's hardcoded per-type form with a declarative `configSchema` published by each tool handler, so adding tool number nine is a registry entry rather than a UI edit.

## Goals

### 1. Declarative tool config schemas

Right now `NodeConfigPanel` renders a `toolType` dropdown and nothing else — a tool has no per-tool settings at all, and `GET /api/tools` returns only `{ type, label }`. Four new tools each need their own fields (a recipient, a channel, a URL and method, a collection name), and hardcoding four more branches into the panel would put the tool catalog in two places at once.

Each `ToolHandler` gains a `configSchema`: an ordered array of field descriptors.

```
configSchema: [
  { key: 'to',      label: 'To',      type: 'text',   required: true, placeholder: 'someone@example.com' },
  { key: 'subject', label: 'Subject', type: 'text',   required: false, default: '(no subject)' },
  { key: 'body',    label: 'Body',    type: 'textarea' },
]
```

Supported `type` values: `text`, `textarea`, `number`, `select` (with `options`), `boolean`. Deliberately small — this is a form renderer, not a schema language.

`GET /api/tools` returns `{ type, label, description, configSchema }`, and the panel renders fields generically from it. Values live under `node.data.config.toolConfig`, keeping them clear of the reserved `label` / `toolType` / `mockOverrides` keys.

### 2. Four new mocked tool handlers

All four go through the existing `withMockBehavior()` wrapper, so they inherit artificial latency, `17`'s failure injection, and `07`'s retry/backoff for free — per `CLAUDE.md`, mocked node behavior must simulate latency, occasional failure, and a plausible templated output.

| Tool | Config fields | Mock output |
|---|---|---|
| `send-email` | `to`, `subject`, `body` | `{ delivered: true, to, messageId: 'mock-<counter>' }` |
| `slack-message` | `channel`, `text` | `{ posted: true, channel, ts: <simulated timestamp> }` |
| `http-request` | `url`, `method` (select), `body` | `{ status: 200, url, method, body: <templated echo> }` |
| `database-write` | `collection`, `document` (textarea, JSON) | `{ inserted: true, collection, id: <ObjectId> }` |

Each handler interpolates its incoming `input` into its output so a chained workflow reads sensibly (e.g. `send-email` reports the subject it was actually given, and templates `{{input.xyz}}` references in `body` against the upstream node's output).

**`http-request` stays mocked, and that is a deliberate decision, not a shortcut.** A tool node that performs real outbound HTTP from a user-supplied URL is a server-side request forgery primitive: any logged-in user could point it at internal addresses and read the response back through the run log. It would also make demo runs depend on network reachability, and it would be the project's first real external dependency, which `CLAUDE.md` rules out. The node simulates a response shaped from its configured method and URL. If a real fetch is ever wanted, it belongs behind an explicit allowlist and an opt-in env flag, specified separately.

**`database-write` gets a genuine, contained side effect.** Instead of pure fiction it inserts into a dedicated `MockRecord` collection scoped to `ownerId`, so the tool is observably real without introducing infrastructure. `POST`-ing garbage in the `document` field fails the node with a JSON parse error, which is a useful realistic failure mode.

### 3. External Event trigger

The fourth `TRIGGER_TYPES` entry ("External Event — e.g. new database row, file uploaded, form submitted") goes live as **named-event dispatch**, which is what distinguishes it from `13`'s webhook rather than duplicating it:

- A webhook token addresses **one** workflow: one token → one run.
- An event name addresses **many**: `POST /api/events/:eventName` starts a run of *every* enabled workflow subscribed to that name. This is the fan-out/pub-sub shape the product brief's "event-driven triggers" pillar is about.

Both reuse the same internal "create + start run" function as `10-manual-run-trigger.md` and `12-scheduled-triggers.md` — four trigger types, one run-creation path.

### 4. Retire `comingSoonCatalog.ACTION_TYPES`

With all seven tools live, the client's hardcoded `ACTION_TYPES` list becomes a second, staler source of truth for something the server already enumerates. Delete it and drive the tool dropdown entirely from `GET /api/tools`. `TRIGGER_TYPES` stays static (a fixed set of four the server doesn't enumerate) but every entry flips to `live: true`.

## Non-goals

- Real email/Slack/HTTP delivery, or any outbound network call. Every tool is simulated; see above.
- Credential or secret storage for tool nodes — there is nothing to authenticate against.
- Event payload schemas, validation, or a subscription registry UI beyond a plain event-name field.
- Guaranteed delivery, ordering, or replay of events. Fire-and-forget, in-process.
- Reading from `MockRecord` via a tool (`database-read`). Write-only is enough to make the side effect visible.

## Data Model

**Workflow** — add:
```
eventTrigger: { eventName: string | null, enabled: boolean }
```

**MockRecord** (new collection, written only by `database-write`):
```
{ _id, ownerId, runId, collection: string, document: Mixed, createdAt }
```

**Node config** for tool nodes settles into:
```
{ label, toolType, toolConfig: { ...per-schema fields }, mockOverrides: { failureRate?, latencyMs?, maxAttempts? } }
```

## API

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/tools` | — | `[{ type, label, description, configSchema }]` (extends the existing route) |
| PUT | `/api/workflows/:id/event-trigger` | `{ eventName, enabled }` | updated trigger |
| DELETE | `/api/workflows/:id/event-trigger` | — | `204` |
| POST | `/api/events/:eventName` | optional JSON payload | `202 { triggered: [runId, ...] }` |

`POST /api/events/:eventName` sits outside auth middleware, matching `13`'s webhook and `18`'s share endpoint. It looks workflows up by `eventTrigger.eventName` + `enabled`, not by `req.userId`.

## UI Behavior

- **Node Config Panel**: selecting a `toolType` renders that tool's fields from its `configSchema`; changing type clears the previous type's `toolConfig` rather than leaving orphaned keys behind. The tool dropdown no longer contains disabled "coming soon" entries.
- **Trigger Panel**: all four trigger types render live. The External Event card takes an event-name input, an enable toggle, and shows a copyable `curl` example — a trigger nobody can figure out how to fire is not a demoable trigger.
- **Run Monitor**: a run's origin (`manual` / `schedule` / `webhook` / `event`) is worth showing in the header, since with four trigger types "where did this run come from?" becomes a real question. This implies a `trigger` field on `Run` — coordinate with `12` and `13`, which introduce the other two sources.

## Edge Cases & Error Handling

- **Unknown `toolType` in a saved workflow** (registry changed, or a template cloned per `15`) → the panel shows the raw stored value with an "unknown tool type" warning and preserves it rather than silently resetting it to empty, which would destroy the user's config. The engine already throws `Unknown tool type: X` at run time; `20`'s validation panel surfaces it before then.
- **`event` name collides across two of the user's workflows** → intended behavior: both run. That is the entire point of event fan-out, not a conflict to resolve.
- **`POST /api/events/:eventName` matching zero workflows** → `202 { triggered: [] }`, not a 404. The caller is a publisher; whether anyone subscribed is not its concern.
- **A subscribed workflow already has a run in progress** → that workflow is skipped (matching `createRun`'s existing 409 guard) but others still fire; the response reports only the runs actually started.
- **`database-write` with malformed JSON in `document`** → node fails with a clear parse error. Not retried into oblivion: a malformed document will never parse, so this failure should bypass retry rather than burn all attempts. Distinguish permanent failures from `SimulatedToolFailure` in the queue.
- **Templated `{{input.foo}}` referencing a missing key** → renders as an empty string with a log line noting the unresolved reference; does not fail the node.

## Acceptance Criteria

- [ ] Selecting each of the seven tool types renders that tool's own fields, driven entirely by `GET /api/tools` with no per-type branching in the panel.
- [ ] Adding an eighth tool to `TOOL_HANDLERS` makes it appear in the dropdown with working config fields and zero client-side changes.
- [ ] `send-email`, `slack-message`, and `http-request` produce plausible outputs that reflect both their config and their upstream input.
- [ ] `database-write` inserts a real `MockRecord` document, verifiable in MongoDB, tagged with the `runId` that wrote it.
- [ ] `database-write` with invalid JSON fails the node immediately without consuming all retry attempts.
- [ ] All four new tools honour a `failureRate` override and retry per `17`/`19`.
- [ ] Two workflows subscribed to the same event name both start runs from a single `POST /api/events/:name`.
- [ ] `POST /api/events/:name` with no subscribers returns `202` and an empty list.
- [ ] `comingSoonCatalog.ACTION_TYPES` is deleted and no component imports it.
- [ ] The Run Monitor shows which trigger started the run.
