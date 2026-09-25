# Spec: Integration Framework

**Status:** Phase 3 — Tier 1
**Milestone:** M4
**Depends on:** `21-extended-tool-catalog.md`, `25-secrets-and-connections.md`
**Revises:** `05-agent-tool-providers.md` (`ToolRegistry` → `IntegrationRegistry`), `21-extended-tool-catalog.md` (tool node config shape, `GET /api/tools`), `14-analytics-dashboard.md` (tool usage grouped by integration), `07-async-job-queue.md` (`Retry-After`)

## Summary

Replaces the flat seven-entry `ToolRegistry` with an **`IntegrationRegistry`** of manifests. An integration (Slack, GitHub, HTTP, …) declares its auth fields, its **actions** and its **triggers**. Each action has a `sandbox` implementation, which is stateful, simulated and always available, and optionally a `live` one. One rule, evaluated per node execution, decides which runs. The engine, the Node Config Panel and the validation panel are driven entirely by manifests, the same way `21` made tool forms schema-driven. Adding integration number twenty-one is a folder, not a UI change.

Every phase-2 workflow and template keeps running. Old `{ toolType, toolConfig }` nodes are migrated, and are also normalised wherever they could still arrive.

## Goals

### 1. The manifest

Each integration lives in `server/src/integrations/<id>/index.js` and exports `defineIntegration({...})`:

```
{
  id: 'slack', name: 'Slack', icon: 'slack', category: 'communication',
  description: 'Post messages to Slack channels.',
  auth: { type: 'webhookUrl', fields: [
    { key: 'webhookUrl', label: 'Incoming webhook URL', type: 'text', required: true, secret: true },
  ]},
  test: async (ctx) => ({ ok: true, detail: 'URL format checked' }),          // optional
  actions: [{
    id: 'post_message', name: 'Post message', description: '…',
    configSchema: [ { key: 'channel', … }, { key: 'text', type: 'textarea', … } ],
    outputSample: { posted: true, channel: '#alerts', ts: '1727…' },
    cacheable: false, sideEffect: true,
    sandbox: async (ctx) => { … },   // required
    live:    async (ctx) => { … },   // optional
  }],
  triggers: [{ id: 'message_received', name: 'Message received', description: '…',
               samplePayload: { … } }],
  inbound: { parse(req) { … }, verify?(req, connection) { … } },       // optional, see 27
  dynamicActions: async (ctx) => [ … ],                                  // optional, see 37
}
```

- **`auth.type`**: `'none' | 'apiKey' | 'bearer' | 'basic' | 'webhookUrl' | 'custom'`. `'none'` means **credentials are optional**, not that there are none. `http` is `'none'` but still declares optional auth fields, so a connection can add a bearer token (`27`).
- **`configSchema`** uses `21`'s descriptor format, plus one new field type, **`json`**: a textarea validated as JSON on save and parsed before the action runs. `database.insert`'s document and `37`'s nested MCP arguments use it. Phase 2 hand-rolled this parse inside `database-write`.
- **`cacheable`** defaults to `true`. **`sideEffect: true`** forces not-cacheable no matter what `cacheable` says, which makes `21`'s rule structural instead of a per-tool flag someone can forget.
- **`test`**, **`inbound`** and **`dynamicActions`** are optional extensions to the phase-3 manifest contract. They're used by `25` (test connection), `27` (inbound webhooks) and `37` (MCP tools discovered per connection).
- **Registration is a static import list** in `server/src/integrations/index.js`, not a directory scan. It's explicit and easy to follow.
- **Boot-time validation:** unique integration and action ids, every `configSchema` well-formed, `sandbox` present on every action, trigger ids unique. An invalid manifest fails boot with the integration's id in the message.

### 2. The action context

`sandbox(ctx)` and `live(ctx)` both receive:

```
ctx = {
  params,        // configSchema values, {{input.x}}-interpolated (existing tools/template.js), json fields parsed
  input,         // upstream output, per 19's fan-in shape
  connection,    // resolveConnection() result (25) — { id, name, mode, config, credentials } — or null
  workspaceId, runId, workflowId,
  logs,          // push(line); redacted by the engine (25)
  sandbox,       // per-workspace store over SandboxRecord (27): insert/find/findOne/update/remove/count/seed
  http,          // safeRequest (27) — the only outbound path; live code never imports http/https/fetch
}
```

The action returns its output object. `defineAction` wraps both implementations so every action gets, without writing it itself:

- **required-param validation**, where a missing required field is a `PermanentFailure` `<Action> requires "<label>"` (currently hand-written in four handlers);
- **for sandbox only:** `withMockBehavior()` from `toolHandlers.js`, meaning artificial latency, `mockOverrides.latencyMs`, and `17`'s `mockOverrides.failureRate` injection. Live calls have real latency and real failures, so injected failure isn't applied to them. The Node Config Panel hides the failure-rate slider for a node that will run live, and says why. **`mockOverrides.maxAttempts` applies to both modes.**
- **for live only: error mapping.** `mapHttpError(response)` converts to the queue's vocabulary. `4xx` becomes `PermanentFailure`. `5xx`, `429`, timeouts and network errors are retryable. `27` refines that for non-idempotent methods. A `429` or `503` with `Retry-After` puts `retryAfterMs` on the error, and the queue uses `max(backoff, retryAfterMs)`, capped at 30 s, as its next delay. That's a small change to `InProcessQueue`'s backoff computation (revises `07`).

### 3. The mode rule, evaluated per node execution

```
live  ⇔  env.integrationsLive
        && action.live exists
        && ( connection?.mode === 'live'
             || (auth.type === 'none' && connection?.mode !== 'sandbox') )
sandbox otherwise
```

| Situation | Mode |
|---|---|
| Slack node, live connection, `INTEGRATIONS_LIVE=true` | live |
| Slack node, no connection selected | sandbox |
| Slack node, `connectionId: 'sandbox'` | sandbox |
| HTTP node, no connection | **live** (C3) |
| HTTP node, a bearer-auth connection in live mode | live, with auth |
| HTTP node, `connectionId: 'sandbox'` | sandbox |
| Any node, `INTEGRATIONS_LIVE=false` | sandbox |
| Jira node (no live adapter), any connection | sandbox |

`INTEGRATIONS_LIVE` is read once, in `server/src/config/integrations.js`. Nothing else checks `process.env` for it. Each node result records **`mode`**, so the run monitor can tell you what actually happened rather than what the config implied.

### 4. `IntegrationRegistry` replaces `ToolRegistry`

`server/src/integrations/IntegrationRegistry.js`:

- **`list()`** returns the client-facing catalogue with no functions: `{ id, name, icon, category, description, auth: { type, fields }, liveCapable, actions: [{ id, name, description, configSchema, outputSample, cacheable, sideEffect, liveCapable }], triggers: [{ id, name, description, samplePayload }], hasInbound }`.
- **`getAction(integration, action)`** returns `null` when either is unknown.
- **`run({ node, input, context })`** is the engine's single entry point, replacing the `node.type === 'tool'` branch of `executeAgentOrTool` in `executeRun.js`:
  1. normalise the node config (Goal 6), then look up the action. Unknown is a `PermanentFailure` `Unknown action: slack.foo`, the same one-attempt behaviour as today's `Unknown tool type`;
  2. `resolveConnection()` (`25`);
  3. decide the mode (Goal 3);
  4. check the cache: cacheable ⇔ `!sideEffect && cacheable && failureRate <= 0`. The failure-rate exception is `17`'s existing rule. The key comes from `25`;
  5. run through `defineAction`'s wrapper, redact (`25`), store in the cache, and return `{ output, logs, cached, mode }`.
- `ToolRegistry.js` and `TOOL_HANDLERS` are deleted. The three demo tools (`fake-weather`, `calculator`, `fake-search`) become the actions of a `builtin` integration, and the four phase-2 action tools move into their real integrations (Goal 6).

### 5. Tool node config shape

```
{ label, integration, action, connectionId: ObjectId | 'sandbox' | null, params: {…}, mockOverrides: { failureRate?, latencyMs?, maxAttempts? } }
```

The node type stays `tool`. Nothing about the graph, the edges or the engine's scheduling changes. **Node results gain** `integration`, `action` and `mode` (`Run.nodeResults[]`), which feed the monitor badges and `14`'s analytics.

### 6. Legacy `{ toolType, toolConfig }`: migrate, and normalise at the edges

**A one-time migration**, plus a normaliser at every entry point, so no legacy shape can reach the engine:

- **Migration** (`server/src/scripts/migrateToolNodes.js`) runs on boot right after `22`'s workspace migration, and is available as `npm run migrate:tool-nodes`. It rewrites every `Workflow` and `Template` node that has `toolType` and no `integration`. It's idempotent, and logs counts.
- **`normalizeToolConfig(config)`** (`server/src/integrations/legacy.js`) applies the same mapping. It's called by `PUT /api/workflows/:id`, template creation, the collaboration op handler (`28`), and `IntegrationRegistry.run()` itself. That way an old API caller, an old check script, or a workflow imported mid-migration still works.

| Legacy `toolType` | New `integration.action` | `toolConfig` → `params` |
|---|---|---|
| `fake-weather` | `builtin.fake-weather` | unchanged |
| `calculator` | `builtin.calculator` | unchanged |
| `fake-search` | `builtin.fake-search` | unchanged |
| `send-email` | `email.send` | `{ to, subject, body }` unchanged |
| `slack-message` | `slack.post_message` | `{ channel, text }` unchanged |
| `http-request` | `http.request` | `{ url, method, body }` unchanged |
| `database-write` | `database.insert` | `collection` unchanged; `document` string → `json` field |
| anything else | `builtin.<toolType>` | unchanged. It then surfaces as `21`'s "unknown" warning rather than being dropped. |

The four action tools map to their **real** integrations rather than to `builtin`. Otherwise Slack would appear twice in the palette, once as a mock-only legacy tool and once as the real integration. Migrated nodes get `connectionId: null`.

**Behaviour change to call out:** a migrated `http.request` node with no connection now runs **live** (C3). The migration logs `N HTTP nodes now make real requests`, and sets `migratedFromMock: true` on those nodes. The Builder shows a one-time "This node now makes real HTTP requests" notice on them, which clears when the node is edited. `seedTemplates.js` is updated to the new shape, and its HTTP nodes point at a public echo endpoint.

### 7. Integration triggers

- Each `triggers[]` entry is a **workspace event** named `<integration>.<triggerId>`, for example `stripe.payment_failed`. It's dispatched through `24`'s per-workspace fan-out. **No new trigger type:** workflows subscribe with the existing event trigger (`21`).
- The event payload that becomes the Start node's input is an envelope: `{ event, integration, connectionId, test: boolean, receivedAt, data }`.
- `Workflow.eventTrigger` gains an optional **`connectionId`** filter (`null` means any connection), so a workspace with two Stripe accounts can listen to just one.
- **Where events come from:** provider-shaped inbound webhooks and "Send test event" (both in `27`).

### 8. Builder and client

- **Node Config Panel:** a searchable **integration picker** (grouped by category, with icons and a *Live-capable* tag), then an **action select**, then `25`'s connection select, then the params form. The params form is the existing `ToolConfigFields`, which gains the `json` type. Changing the integration or action clears `params`, following `21`'s "no orphaned keys" rule. There's a `mode` hint: "Runs **live** via <connection>", "Runs in **sandbox** (no connection)", or "Live calls disabled on this server".
- **Node palette:** besides the generic Tool node, an **Integrations** section lists every integration. Dragging Slack drops a tool node pre-set to `integration: 'slack'`.
- **Canvas node (`BaseNode`):** shows the integration icon and `Integration · Action` instead of today's raw `toolType` line, plus a small LIVE or SANDBOX badge predicted from the current config.
- **Run monitor:** each tool node shows the **actual** `mode` from its result.
- **`validateGraph.js`** (`20`):
  - missing integration or action → error;
  - unknown integration or action → warning, with the raw value kept;
  - required param empty → warning;
  - `auth.type !== 'none'` and no connection → info, "runs in sandbox until a connection is selected";
  - connection `status: 'error'` → warning.
- **Trigger panel, External Event card:** alongside the free-text name, a **"From an integration"** picker lists every integration trigger across the catalogue, sets `eventName`, and optionally picks a connection filter.
- **`client/src/api/tools.js`** becomes `api/integrations.js`. `workflowStore`'s default tool node becomes `{ label: 'New Tool', integration: '', action: '', connectionId: null, params: {} }`.

## Non-goals

- Integrations loaded as third-party plugins, or discovered from npm. The import list is static and first-party.
- A visual manifest editor, or user-defined integrations. The HTTP Request integration is the escape hatch for anything that isn't in the catalogue.
- Per-action rate limiting, or quota tracking against provider limits.
- Streaming or long-poll actions. Every action is request/response within the node's queue attempt.
- Failure injection on live calls. Real services fail on their own.

## Data Model

**Tool node `data.config`**: as in Goal 5. It sits inside `Workflow.nodes[].data` (`Mixed`), so there's no Mongoose schema change.

**Run.nodeResults[]**: adds `integration: string | null`, `action: string | null`, `mode: 'live' | 'sandbox' | null`.

**Workflow.eventTrigger**: adds `connectionId: ObjectId | null`.

## API

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/integrations` | JWT | `{ integrations: [...list()], defaults: { failureRate, maxAttempts }, liveEnabled }` |
| GET | `/api/integrations/:id` | JWT | one manifest (client shape) |
| GET | `/api/integrations/:id/actions?connectionId=` | JWT + workspace | static actions plus `dynamicActions` for that connection (`37`) |

`GET /api/tools` is **removed**. Its only callers are the client (moved to `/api/integrations`) and the phase-2 check scripts, which are updated for `22`'s header anyway.

## UI Behavior

Covered in Goal 8. The integrations gallery and detail pages belong to `27`, and the connection forms to `25`.

## Edge Cases & Error Handling

- **A saved node references an integration or action that's been removed** → the panel shows the raw ids with an "unknown" warning and preserves them (`21`'s rule). The engine fails the node as `PermanentFailure` in one attempt.
- **Live action throws something non-HTTP** (a bug) → retryable up to `maxAttempts`, then failed, with the message redacted. No crash, since `runNode` already treats failures as results.
- **Params reference `{{input.x}}` that doesn't resolve** → empty string plus a log line, exactly as `template.js` does today.
- **A `json` param that doesn't parse** → `PermanentFailure` before the action runs. That's `21`'s `database-write` behaviour, now generic.
- **A node's connection is switched from live to sandbox between two runs** → the second run's node results say `sandbox`. Cached entries from the live run aren't reused, because the connection id and mode are both part of the key.
- **`INTEGRATIONS_LIVE=false` with live connections configured** → everything runs sandbox. The UI's `liveEnabled: false` banner explains why nothing is posting.
- **Migration meets a node with both `toolType` and `integration`** → `integration` wins, and `toolType` and `toolConfig` are deleted.

## Acceptance Criteria

- [ ] Every manifest passes boot-time validation, and a deliberately broken one fails boot naming the integration.
- [ ] The Node Config Panel renders every integration's actions and params from `GET /api/integrations`, with no per-integration branching in the client.
- [ ] Adding a new integration folder and one import line makes it appear in the palette, the picker and the trigger picker, with zero client changes.
- [ ] The mode rule is checked exhaustively across `INTEGRATIONS_LIVE` × `action.live` × `auth.type` × connection mode (`null` / `'sandbox'` / live / sandbox), and each node result records the actual mode.
- [ ] Failure injection affects sandbox calls only. `maxAttempts` affects both modes.
- [ ] A live `4xx` fails in one attempt. A live `503` with `Retry-After: 2` waits at least 2 s before retrying.
- [ ] Side-effecting actions are never served from the cache, whatever their `cacheable` flag says.
- [ ] After migration, every phase-2 workflow and seed template opens, validates and runs. Running the migration twice gives the same result. A legacy-shaped `PUT` is normalised.
- [ ] Migrated HTTP nodes carry `migratedFromMock` and show the one-time live notice.
- [ ] `stripe.payment_failed` can be chosen from the trigger picker, and a workflow subscribed with a connection filter ignores events from other connections.
- [ ] Analytics' tool usage is grouped by `integration` (revises `14`).

`npm run check:integrations` and `npm run check:engine` (extended) cover these.
