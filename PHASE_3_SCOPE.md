# Phase 3 — Scope (Final Phase)

Phase 1 shipped the core loop (specs `01`–`11`). Phase 2 turned every "Coming Soon" badge live and made the engine genuinely concurrent (`12`–`21`). Both phases were built for **one person working alone**.

Phase 3 turns AgentFlow from a single-user demo into something that **feels like a real product a team would use**:

1. **Multi-tenancy.** Workspaces, members, roles and invitations, with strict isolation between tenants.
2. **Collaboration.** Several people editing the same workflow at the same time, with presence, comments, mentions, notifications and version history.
3. **Integrations.** A catalogue of about 20 integrations with stored credentials. Each works end to end against a stateful sandbox, and a few can call the real service.
4. **Depth where production tools have it.** Loops, sub-workflows, human approval steps, error branches, re-runs from a failed node, and fair scheduling across tenants.

It should look and feel like production software, but it doesn't have to be production-grade. The rule from `CLAUDE.md` still holds: everything runs with `npm run dev` and a MongoDB connection string. There's no Redis, no Docker and no managed services.

---

## Constraint changes (approved 2026-09-25)

`CLAUDE.md` says its constraints stand "unless the user explicitly requests otherwise." The phase-3 brief asked for things those constraints ruled out. Each is listed with the narrowest change that delivers it. **All four are approved, and `CLAUDE.md` has been amended to match.**

| # | Current constraint | Proposed change | Why this narrow version |
|---|---|---|---|
| C1 ✅ *approved* | "Single-instance, single-user-at-a-time context"; don't add defensive code for scenarios that can't happen | Multi-user and multi-tenant are now real scenarios. Code that enforces **tenant isolation** (scoped queries, socket auth, encrypted secrets) is in scope. Scalability hardening (clustering, rate limiting, an observability stack) is still out. | Once two tenants exist, a cross-tenant leak is no longer hypothetical. It's the headline bug class for this phase. |
| C2 ✅ *approved* | "Tools remain mocked in both cases" | **Live mode is on by default** (`INTEGRATIONS_LIVE=true` in `.env.example`). A live-capable integration calls the real service whenever its connection has credentials. The stateful per-workspace sandbox is used when no connection is selected, when a connection is switched to sandbox mode, or for integrations with no live adapter. Setting `INTEGRATIONS_LIVE=false` is a kill switch for offline development and deterministic check runs. | This delivers "it actually posted to my Slack" out of the box, and every integration still works with no accounts at all. It follows the same env-config pattern `AgentProvider` already uses. |
| C3 ✅ *approved* | Phase 2 non-goal: the `http-request` tool never makes real calls, because of SSRF | **The HTTP Request tool makes real calls, live by default, with no connection required.** It always runs behind an **SSRF guard** (details in spec `27`): the destination IP is checked when the connection opens, so a DNS rebinding answer can't slip past; loopback, private, link-local and cloud metadata ranges are blocked; every redirect hop is checked again. There's also a timeout, a response size cap, and an optional host allowlist. | The phase-2 reasoning was correct. This addresses the risk head-on instead of ruling the feature out. |
| C4 ✅ *approved* | *(new)* Nothing covers MCP | AgentFlow consumes **MCP servers** as a connection type, and lets agents call MCP tools (spec `37`). Adds one dependency, `@modelcontextprotocol/sdk`, loaded lazily like the Anthropic SDK. Local (stdio) MCP servers come **only from an operator-controlled allowlist**. | A stdio server is a command the backend runs on its own machine, so letting a tenant type one in would let them run any code on the server. Remote MCP servers go through the same SSRF guard as HTTP. |

Unchanged: no Redis, Kafka, RabbitMQ, Docker or Kubernetes. The queue, cache, cron registry, collaboration hub and MCP connection pool stay in-process singletons. `AgentProvider` stays mock by default. Live integrations make the product more real, but agent reasoning is a separate switch.

---

## What already exists (audit against the current tree)

Phase 3 is mostly new territory, but several pieces of phase 2 are either foundations to build on or **latent multi-tenant bugs** that have to be fixed before anything else.

### Foundations to build on

| Existing piece | Where | Phase-3 use |
|---|---|---|
| Declarative `configSchema` per tool, served by `GET /api/tools` | `tools/toolHandlers.js`, `ToolRegistry.js` | Grows into the **integration manifest** format (spec `26`). The generic form renderer already works. |
| `defineTool()` + `withMockBehavior()` wrapper | `tools/toolHandlers.js` | Becomes the mock half of every integration action |
| `cacheable: false` for side-effecting tools | `toolHandlers.js`, `executeRun.js` | Carries over unchanged to integration actions |
| `PermanentFailure` vs retryable errors | `queue/errors.js` | Maps directly onto live-API errors: 4xx is permanent, 5xx and timeouts are retryable |
| One run-creation path, `createAndStartRun()` | `services/runService.js` | Where tenant quotas, version pinning and integration triggers get enforced |
| Named-event fan-out, `POST /api/events/:name` | `routes/events.js` | Becomes per-workspace namespaced events and integration triggers |
| `MockRecord` collection (real, contained side effect) | `models/MockRecord.js` | Generalises into the per-workspace **sandbox store** behind stateful mocks |
| Socket rooms per run (`run:<id>`) | `sockets/index.js` | Pattern reused for `workflow:<id>` (collaboration) and `workspace:<id>` (notifications) |
| Undo/redo command store | `client/src/store/workflowStore.js` | The discrete, command-shaped edits map naturally onto collaboration ops |
| Read-only share links | spec `18` | Kept as-is. Workspace roles are added alongside it and don't replace it. |
| Lazy-loaded `LLMAgentProvider` | `providers/LLMAgentProvider.js` | Agent presets (classify, extract, summarise) build on it. Still only structurally tested (report §14.7). |

### Latent bugs that multi-tenancy turns into real leaks

These are harmless with one user. **They have to be fixed in week 1, before a second tenant exists.**

| Issue | Where | Consequence with tenants |
|---|---|---|
| **Sockets are unauthenticated.** There's no `io.use()`, and `run:subscribe` joins any `runId` it's given. | `sockets/index.js`, `hooks/useRunSocket.js` | Anyone with a socket connection can stream any tenant's run outputs live |
| **`queue:stats` is broadcast to every socket** | `sockets/index.js` | Leaks other tenants' activity levels (minor, but it's the same class of bug) |
| **The tool cache key is global**: `toolCacheKey(toolType, toolConfig, input)` | `cache/TTLCache.js`, `executeRun.js` | Tenant B can get a cache hit on tenant A's result. Once live integrations use per-tenant credentials, that's a **data leak**. The key must include `workspaceId` and `connectionId`. |
| **Event names are one global namespace** (already documented in report §13.1) | `routes/events.js` | Tenants fire each other's workflows |
| Ownership is checked with `ownerId` in **26 places across 8 files** | controllers, `runService`, `executeRun`, `toolHandlers`, seed | Every one of these moves to `workspaceId` + role. A single missed spot is a cross-tenant read. |
| Saves are **whole-document `PUT`s** (last write wins) | `workflowController.update`, `workflowStore` | Two collaborators silently overwrite each other's work |

---

## Specs for this phase

Spec numbering continues from `21`. Each gets a full spec file in `spec/`, in the existing format, before it's implemented. Specs fall into three tiers: **Tier 1 is the definition of done** for phase 3, Tier 2 is what makes the product feel deep, and Tier 3 is polish. If time runs short, cut from the bottom up.

### Tier 1 — Core (must ship)

| Spec | Feature | Summary |
|---|---|---|
| `22-workspaces-multitenancy` | Workspaces & tenant isolation | `Workspace` + `Membership` models. Every tenant-owned collection gets `workspaceId`. A `requireWorkspace` middleware resolves membership and role from the `X-Workspace-Id` header. A single `scoped(Model, req)` query helper means routes never call `Model.find()` bare. Workspace switcher in the nav. On first boot a **migration** moves each existing user's data into a "Personal" workspace. |
| `23-roles-and-invitations` | RBAC and team management | Four roles: **Owner / Admin / Editor / Viewer**, backed by a permission matrix (who can edit, run, manage connections, invite, delete). Invite by email, delivered as a token link. Pending invites can be accepted, revoked or expire. A Members page lets you change roles and remove people. Invite emails land in a dev **Outbox** page instead of being sent. |
| `24-socket-auth-and-namespaced-events` | Secure real-time layer & per-tenant events | JWT handshake via `io.use()`. Every room join is checked against membership. Rooms are `workspace:<id>`, `workflow:<id>` and `run:<id>`. Queue stats are scoped per workspace. Events move to `POST /api/w/:workspaceSlug/events/:name`, authenticated by a **workspace API key**. |
| `25-secrets-and-connections` | Credential vault | A `Connection` model (`workspaceId`, `integration`, `name`, `mode: sandbox\|live`, encrypted `credentials`). Encryption is AES-256-GCM via `node:crypto`, keyed by `SECRETS_MASTER_KEY`. Secrets are **write-only**: never returned after they're saved, and always shown masked. Includes a "Test connection" action and a Connections page. |
| `26-integration-framework` | Integration manifest & providers | An `IntegrationRegistry` replaces the flat `ToolRegistry`. Each integration has a manifest (`id`, `name`, `icon`, `category`, `auth` schema, `actions[]` and `triggers[]`, each with a `configSchema` and output sample) plus two implementations: `sandbox` (always present) and `live` (where supported; used by default when credentials exist, per C2). Tool node config becomes `{ integration, action, connectionId, params }`. Phase-2 tools map onto it (`fake-weather`/`calculator`/`fake-search` → `builtin.*`; `send-email` → `email.send`, `slack-message` → `slack.post_message`, `http-request` → `http.request`, `database-write` → `database.insert`) through a boot migration plus a read-time normaliser, so every phase-2 workflow and template keeps running. |
| `27-integration-catalog` | ~20 concrete integrations | The catalogue listed below. Sandbox mocks are **stateful** through a per-workspace `SandboxRecord` store: creating a GitHub issue and then listing issues returns it, and appending a Sheet row and then reading the sheet includes it. That's what makes mocks feel like the real thing. |
| `37-mcp` | MCP client & agent tool use | MCP servers become connections, with tool discovery, an MCP Tool node, and agents that choose and call tools during their reasoning. See the dedicated section below. *(It's numbered 37 because it was added after `22`–`36` were drafted.)* |
| `28-realtime-collaboration` | Live co-editing | Presence (avatars, live cursors, "who's viewing" on node selection) and op-based sync over Socket.io: add, move, update or delete a node; add, delete or relabel an edge; rename. Ops get a server-assigned sequence number and conflicts resolve **per entity field, last writer wins**. Opening a node's config panel takes a **soft lock**. Late joiners get a snapshot plus the ops since then. Autosave replaces the Save button while collaborating. |
| `30-workflow-versioning` | Versions, draft/publish | A `WorkflowVersion` snapshot is saved on **Publish**. Triggers (cron, webhook, event, integration) always run the **published** version, and the canvas edits the **draft**. Version list with author and message, a visual diff (nodes added, removed or changed, highlighted on the canvas), and restore. Every `Run` records the `versionId` it executed. |

### Tier 2 — Depth (should ship)

| Spec | Feature | Summary |
|---|---|---|
| `29-comments-mentions-notifications` | Collaboration beyond editing | Comment threads pinned to a node or the canvas, `@mentions`, and a resolve/reopen flow. An in-app notification centre (bell, unread count, pushed over `workspace:<id>` and `user:<id>` rooms) for mentions, invites, run failures on workflows you watch, and approvals waiting on you. |
| `31-advanced-nodes` | Engine power features | **Transform** (field mapping with `{{ }}` expressions), **Code** (JS expression via `node:vm` with a timeout; scoped as "trusted-workspace code", not a security sandbox), **Delay**, **Loop / For-each** (fans out over an array through the queue, then collects results), **Merge** (wait-all / first-wins), **Sub-workflow** (runs another workflow in the same workspace, with a recursion depth guard), and an **On-error branch** (a failure edge instead of failing the run). |
| `32-human-in-the-loop` | Approval node & resumable runs | An **Approval** node pauses the run in a new `waiting` status and notifies assignees. The run resumes on approve or reject, from the UI or a signed link. A waiting run is **persisted and resumed from MongoDB**, so it survives a server restart. A startup reconciler marks runs that were mid-flight during a crash as `failed (interrupted)` instead of leaving them `running` forever. |
| `33-fair-queue-and-quotas` | Multi-tenant scheduling | The queue goes from FIFO to **per-workspace round-robin**, so one tenant's 50-node fan-out can't starve everyone else. Each workspace gets a concurrency cap and a daily run quota from its **plan** (Free / Team / Enterprise; mocked, no payment). A Usage page shows runs, node executions, integration calls and cache hit rate against those limits. |
| `35-run-operations` | Operating runs like a real tool | **Re-run** (same input), **retry from failed node** (reuses the upstream outputs already recorded), and run search and filters (status, trigger, version, date, workflow). The shared run detail view closes report §13.5. Analytics become **live over the socket** and gain a per-workflow view (report §13.6, §14.6). A retry and backoff timeline sits in the run monitor (report §14.8). |

### Tier 3 — Polish (ship what fits)

| Spec | Feature | Summary |
|---|---|---|
| `34-audit-log` | Accountability | An append-only `AuditEvent` log (who, what, target, when, before/after summary) for member, role, connection, publish, delete and API-key actions. Owners and Admins get a filterable Audit Log page. |
| `36-production-polish` | The "real product" feel | A ⌘K command palette, an onboarding checklist and a seeded **demo workspace** (a script creates two tenants, members, connections, published workflows and run history). Also: settings pages (profile, workspace, API keys, danger zone), template management (edit and delete; report §13.3), error boundaries, skeleton loaders, consistent empty states, a system status page (queue, cache, cron registry, socket count), and CI via GitHub Actions running the existing check suites against a service-container MongoDB. |

---

## Integration catalogue (spec `27`)

Every integration has a **sandbox** implementation: realistic latency, occasional simulated failures, realistic output shapes, and state that persists per workspace. Integrations marked **Live** also have a real adapter, which is **used by default** whenever a connection with credentials is selected (C2). Integrations that need no credentials (HTTP Request, Outbound Webhook, RSS) are live with no connection at all. Live adapters use only API-key or webhook-URL credentials. No OAuth, because OAuth needs a registered app and a public callback URL.

| Category | Integration | Actions | Triggers | Live? |
|---|---|---|---|---|
| Communication | **Slack** | Post message, Post to thread | Message received | ✅ incoming-webhook URL |
| | **Discord** | Send message, Send embed | — | ✅ webhook URL |
| | Microsoft Teams | Post message | — | sandbox |
| | Email (SMTP) | Send email | Email received | sandbox → Outbox |
| | Twilio SMS | Send SMS | SMS received | sandbox |
| Developer | **GitHub** | Create issue, Comment, List issues, Get repo | Issue opened, PR opened | ✅ PAT, `api.github.com` only |
| | Jira | Create ticket, Transition ticket | Ticket created | sandbox |
| | Linear | Create issue | Issue created | sandbox |
| Data & Productivity | Google Sheets | Append row, Read rows, Update row | Row added | sandbox |
| | Notion | Create page, Query database | — | sandbox |
| | Airtable | Create record, List records | Record created | sandbox |
| | **Database** (built-in) | Insert, Find, Update | — (dropped: a trigger on its own writes invites loops) | ✅ real, in `SandboxRecord` |
| Commerce & CRM | Stripe | Create customer, Create invoice, Refund | Payment succeeded, Payment failed | sandbox |
| | HubSpot | Create contact, Update deal stage | Contact created | sandbox |
| Web | **HTTP Request** | GET/POST/PUT/PATCH/DELETE; optional auth from a connection | — | ✅ **live by default**, behind the SSRF guard (C3) |
| | **Outbound Webhook** | POST JSON to URL | — | ✅ behind SSRF guard |
| | RSS | Read feed | New item | ✅ behind SSRF guard |
| AI | **LLM Agent presets** | Classify, Extract fields, Summarise, Draft reply | — | ✅ via `AGENT_PROVIDER` |
| | **MCP servers** (spec `37`) | Any tool the server lists (discovered at runtime) | — | ✅ remote (Streamable HTTP) or allowlisted stdio |
| | Knowledge Base | Search workspace docs | — | real, in-process (TF-IDF over uploaded text) |
| Built-in | Weather, Calculator, Search (the phase-2 tools) | unchanged | — | sandbox |

**Integration triggers** reuse the event pipeline. Each fires in one of two ways:

- a **provider-shaped inbound webhook** at `POST /api/w/:slug/hooks/:integration`, or
- a **"Send test event"** button that emits the manifest's sample payload. This makes every trigger demoable without the real service.

### The live HTTP Request tool (C3, detail)

The first live adapter to be built. It needs nothing from `25`, so it can ship early as a standalone slice.

- **Transport:** Node's built-in `http`/`https` modules with a custom DNS `lookup`, so the resolved IP is validated at the moment the connection opens. No new dependency.
- **Blocked destinations:** `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16` (includes cloud metadata), `0.0.0.0/8`, `100.64/10`, IPv6 loopback, link-local and unique-local, and IPv4-mapped IPv6 forms of all of these. Only `http:` and `https:` are allowed.
- **Redirects** are followed manually, up to 3 hops, and every hop is checked again. A public URL that redirects to `http://127.0.0.1` gets blocked.
- **Limits:** 10 s timeout, 1 MB response cap (the body is truncated and the output flags it), optional `HTTP_TOOL_ALLOWED_HOSTS` allowlist.
- **Dev escape hatch:** `HTTP_TOOL_ALLOW_PRIVATE_NETWORKS=false` by default. Setting it to `true` lets a workflow call `localhost`, for example to chain into AgentFlow's own webhook endpoint. It's documented as local-development only.
- **Output:** `{ status, ok, headers (selected), body (parsed JSON when the response is JSON, otherwise text), durationMs, truncated }`.
- **Errors fit the existing retry machinery:** network errors, timeouts, `429` and `5xx` are retryable (honouring `Retry-After`). Other `4xx` responses and SSRF blocks are `PermanentFailure`s, since retrying a blocked address is pointless.
- **Caching:** `cacheable: false` by default, matching phase 2. A per-node "Cache GET responses" toggle can opt in.
- **Auth:** an optional connection (bearer token, API-key header, or basic auth), stored encrypted per `25`. Secrets are added to the request and **redacted from run logs and outputs**.

---

## MCP (spec `37`)

The [Model Context Protocol](https://modelcontextprotocol.io) is the standard way AI tools expose capabilities to agents. For an *agent orchestration* platform, it's the most on-brief integration there is. AgentFlow uses it as a **client** in two ways:

### 1. MCP client: servers as connections

- **Connection type `mcp`** with two transports:
  - **Streamable HTTP** (a remote URL). Any Editor or above can add one. The URL goes through the C3 SSRF guard, and an optional auth header is stored encrypted per `25`.
  - **stdio** (a local process). Tenants **pick from** `server/mcp-servers.json`, an operator-maintained allowlist of `{ id, name, command, args, env }`. They can never type in a command.
- **Discovery:** on connect, `tools/list` runs, and each tool appears in the node palette grouped under its server. The tool list is cached per connection in the TTL cache, with a "Refresh tools" action.
- **Forms from schemas:** each tool's JSON Schema `inputSchema` becomes the existing `configSchema` form. Flat schemas (string, number, boolean, enum) get real fields. Nested schemas fall back to a JSON editor with schema validation. `{{input.x}}` templating works in every argument.
- **The MCP Tool node** calls `tools/call`. Text content blocks are joined into the output, and `structuredContent` is used when the server returns it.
- **Errors:** `isError: true` from the server is a `PermanentFailure` (the tool ran and said no). Transport errors and timeouts are retryable.
- **Caching follows the server's tool annotations:** only tools marked `readOnlyHint: true` are cacheable, and the cache key includes `connectionId`.
- **Connection pool:** one MCP client per connection per process, connected lazily, closed after 5 idle minutes, and reconnected with backoff. It's an in-process singleton, like the queue.

### 2. Agents that use tools

This delivers `definition.md`'s "agents collaborate to accomplish complex tasks by using tools, APIs, and external services."

- An agent node gets a **Tools** multi-select that can include MCP tools *and* the integration actions from `27`.
- **`LLMAgentProvider`** runs a manual tool-use loop: the model requests a tool, AgentFlow executes it, and the result goes back to the model. It stops after at most 8 iterations or when the model finishes.
- **`MockAgentProvider`** picks a tool by matching keywords between the input and each tool's name and description, fills the arguments from the input, and **calls the tool for real**. So tool use works in the default mock mode too.
- **Every tool call the agent makes goes through AgentFlow's own queue**, so each one gets retries, caching and a log line. Calls are streamed as a new `agent:tool_call` socket event. The run monitor shows the agent's steps (thought, tool call, result, thought, answer) as a nested timeline under the node.
- **Why our own client, not the Claude API's built-in MCP connector** (`mcp_servers` + `mcp_toolset`): the connector runs tool calls from Anthropic's side. That means it only reaches *publicly reachable remote* servers (no stdio, no localhost), it only works with the real LLM provider and not the mock default, and it bypasses AgentFlow's queue, retries, cache and live monitor. Using it would hide exactly the orchestration layer this project exists to show. It stays an option for later, not the design.
- **Model config:** the model id moves out of `LLMAgentProvider` (currently hardcoded) into the provider config module as `ANTHROPIC_MODEL`, defaulting to `claude-opus-5`.

### Servers available for the demo

- **Bundled demo server** (`server/src/mcp/demoServer.js`, stdio, on the allowlist by default). It exposes `lookup_customer`, `get_order`, `search_kb` and `create_ticket` backed by the sandbox store, so MCP works offline and in check scripts.
- **A public remote MCP server** for the live part of the demo. Which one is still to be chosen and tested before relying on it.

---

## Architecture changes at a glance

```
Client ── REST (X-Workspace-Id) ──▶ requireAuth → requireWorkspace(role) → scoped controllers
   │                                                         │
   └── Socket.io (JWT handshake) ──▶ rooms: workspace:<id>  user:<id>  workflow:<id>  run:<id>
                                          │            │           │             │
                                   notifications  mentions   collab hub     run events
                                                            (ops, presence,
                                                             soft locks)

createAndStartRun(workflow, trigger)
   ├─ resolve published WorkflowVersion
   ├─ check workspace quota (plan)
   └─ executeRun ──▶ FairQueue (round-robin per workspace, per-tenant caps)
                        ├─ IntegrationRegistry.run(action, connection)
                        │     ├─ live impl    → SSRF-guarded request (default when credentials exist)
                        │     └─ sandbox impl → SandboxRecord (per workspace)
                        ├─ MCP tool node → McpPool (per connection) → tools/call
                        └─ agent node → AgentProvider tool-use loop
                                          └─ each tool call → queue → integration / MCP tool
                        cache key: workspaceId + integration + action + connectionId + params + input
```

**Socket event names** keep the `concern:verb` convention from phase 1:
`presence:join|leave|cursor`, `collab:op|ack|snapshot|lock|unlock`, `comment:created|resolved`, `notification:new`, `run:waiting|resumed`, `agent:tool_call`, plus the existing `run:*`, `node:update`, `queue:stats`.

---

## Progress

| Spec | Written | Implemented |
|---|---|---|
| `22-workspaces-multitenancy` | ✅ | ✅ `check:tenancy` 102 + all phase-2 suites green (344 checks); browser smoke 6/6 |
| `23-roles-and-invitations` | ✅ | ✅ `check:rbac` 98 (exhaustive matrix); browser invite→viewer 20/20 |
| `24-socket-auth-and-namespaced-events` | ✅ | ✅ `check:realtime` 72, `check:triggers` 33; browser live demote/evict 8/8 |
| `25` / `27` foundations (vault, redaction, `safeRequest`) | ✅ | ✅ `check:http` 97 |
| `25-secrets-and-connections` | ✅ | ✅ `check:integrations` 141 (incl. live-path redaction); browser 24/24 |
| `26-integration-framework` | ✅ | ✅ registry, mode rule, legacy migration; builtin/http/slack/email/database manifests |
| `33-fair-queue-and-quotas` | ✅ | ✅ `check:queue` 56 |
| `34-audit-log` | ✅ | ✅ `check:audit` 73 |
| `27-integration-catalog` | ✅ | ✅ 20 integrations (6 live-capable), SandboxRecord, signed inbound webhooks, test events, RSS, knowledge base, AI presets; `check:catalog` 72, `check:inbound` 58 |
| `28-realtime-collaboration` | ✅ | ✅ hub + op sync + soft locks + autosave; `check:collab` 112; 3-browser test 21/21 |
| `31-advanced-nodes` | ✅ | ✅ node registry, transform/code/delay/loop/merge/sub-workflow/error branch; `check:nodes` 79 (incl. no-deadlock) |
| `29-comments-mentions-notifications` | ✅ | ✅ threads, mentions, bell, watchers; `check:comments` 87; 2-browser 22/22 |
| `30-workflow-versioning` | ✅ | ✅ publish/draft, diff, restore, rollback, runs record their graph; `check:versions` 79 |
| `32-human-in-the-loop` | ✅ | ✅ approval node, parked runs resume across kill -9, interrupted reconciler; `check:approvals` 66 |
| `37-mcp` | ✅ | ✅ MCP pool, allowlisted stdio + SSRF-guarded HTTP, demo server, agent tool loop; `check:mcp` 106; browser 30/30 |
| `35-run-operations` | ✅ | ✅ re-run (recorded graph), retry-from-failed (reuses results), Runs page, shared run detail, live + per-workflow analytics, attempt timelines; `check:runs` 85 |
| `36-production-polish` | ✅ | ✅ grouped nav + user menu, one-row Builder toolbar, ⌘K palette + `/api/search`, UI kit (skeletons, empty states, confirm dialog, error boundaries, 404), profile + password + sign-out-everywhere, template edit/delete, onboarding checklist, status page, `seed:demo`, `check:all`, CI, README; `check:polish` 63 |
| Real-model providers (added at the user's request) | — | ✅ OpenRouter (`AGENT_PROVIDER=openrouter`, free tier via `openrouter/free` / `:free` models) and OpenAI (`AGENT_PROVIDER=openai`), same Chat Completions client; OpenCode removed; `check:providers` (stubbed client); `npm run try:llm` (`--list-free`, `--models`) for real calls |

**Phase 3 is implemented.** Final state: `npm run check:all` — **24/24 suites, 1,904 checks** green on one throwaway server; 15 browser tests (1–3 browsers each, live mode on) **252/252**, no page errors.

Known minor issue: right after navigating between Builder pages, opening a node can briefly show "You're editing this node in another tab" until the previous page's lock release lands (spec 28 lock timing; self-clears).

### Cross-spec rules settled while writing the specs

These came out of the specs themselves and bind more than one of them:

- **Nothing that waits holds a queue slot.** Only work (agent turns, tool and integration calls, code) is a queue job. Loops, sub-workflows, delays, merges (`31`), approvals (`32`) and agent tool loops (`37`) are orchestrated by the engine. Otherwise nested waiting deadlocks the bounded pool, and `33`'s fairness couldn't hold.
- **Every run records the graph it executed**: `versionId` for published runs, a graph snapshot for draft test runs (`30`). Re-run and retry-from-failed replay that graph, never the current draft (`35`). The monitor draws the run's own graph, which fixes a latent phase-2 bug where old runs drew against the current graph.
- **One active run per workflow per kind** (draft or published). Waiting runs and child runs don't count (`30`, `31`, `32`).
- **One permission matrix** (`23`) lists every row, including those introduced by `29`–`33`.
- **One workspace-delete cascade list** (`22`). Every spec that adds a tenant collection adds it there, and `check:tenancy` enforces it.
- **Secrets are redacted before anything is logged, streamed, cached or stored** (`25`), and again in audit `before`/`after` (`34`).

### New env vars and dependencies

| Variable | Default | Spec |
|---|---|---|
| `SECRETS_MASTER_KEY` | *(required; boot fails with a generate command)* | `25` |
| `INTEGRATIONS_LIVE` | `true` | `26` (C2) |
| `HTTP_TOOL_ALLOW_PRIVATE_NETWORKS` / `HTTP_TOOL_ALLOWED_HOSTS` | `false` / empty | `27` (C3) |
| `COLLAB_FLUSH_DEBOUNCE_MS` / `COLLAB_FLUSH_MAX_MS` / `COLLAB_LOCK_TTL_MS` | 1000 / 5000 / 60000 | `28` |
| `CODE_NODE_ENABLED` / `CODE_NODE_TIMEOUT_MS` / `CODE_NODE_MEMORY_MB` | see spec | `31` |
| `DELAY_INLINE_MAX_MS` / `DELAY_MAX_MS` / `LOOP_MAX_ITEMS` / `SUBWORKFLOW_MAX_DEPTH` | see spec | `31` |
| `APPROVAL_LINK_SECRET` | *(required when approvals are used)* | `32` |
| `QUEUE_CONCURRENCY` | **8** (was 4) | `33` |
| `OPERATOR_EMAILS` | empty | `36` |
| `ANTHROPIC_MODEL` / `MCP_CALL_TIMEOUT_MS` / `AGENT_TOOL_RESULT_MAX_CHARS` | `claude-opus-5` / see spec | `37` |
| `AGENT_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_MAX_TOKENS`, `OPENROUTER_BASE_URL`, `OPENROUTER_APP_URL`, `OPENROUTER_APP_NAME` | `openrouter/free` / 4096 / `https://openrouter.ai/api/v1` | OpenRouter provider — the free-tier real provider for the demo (added at the user's request, replacing OpenCode). |
| `AGENT_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT`, `OPENAI_MAX_COMPLETION_TOKENS`, `OPENAI_BASE_URL` | `gpt-5.4-mini` / empty / 4096 | OpenAI provider. `check:providers` covers both with a stubbed client; `try:llm` makes real calls. |
| `SLACK_TEST_WEBHOOK_URL`, `DISCORD_TEST_WEBHOOK_URL`, `GITHUB_TEST_TOKEN`, `GITHUB_TEST_REPO` | empty; only for `check:integrations:live` | `27` |

New npm dependencies: `@modelcontextprotocol/sdk` (lazy, `37`) and `fast-xml-parser` (RSS, `27`). New migrations that run on boot and can be run by hand: `migrate:workspaces` (`22`), `migrate:tool-nodes` (`26`), `migrate:versions` (`30`).

---

## Build order (6 weeks)

Steps are ordered by dependency. Each one should be demoable on its own.

| Week | Step | Specs | Why here |
|---|---|---|---|
| 1 | Tenancy foundation | `22`, `24`, cache-key fix | Everything else is scoped by `workspaceId`. Leaks must be closed before a second tenant exists. |
| 1 | Live HTTP Request tool + SSRF guard | part of `27` (C3) | Independent of everything else, and the guard is reused later by remote MCP, the outbound webhook and RSS. An early visible win. |
| 1–2 | Roles & invitations | `23` | Collaboration needs more than one member to collaborate with |
| 2 | Real-time collaboration | `28` | The highest-risk item technically, so it gets the most runway. Depends on socket auth from `24`. |
| 3 | Versioning | `30` | Autosaved collaborative drafts make draft/publish necessary: triggers must not run half-edited graphs |
| 3 | Secrets & integration framework | `25`, `26` | The manifest refactor has to land (with backward compatibility) before any catalogue work |
| 4 | Integration catalogue | `27` | Build the sandbox store first, then the ~20 integrations, then the remaining live adapters |
| 4 | MCP client + agent tool use | `37` §1–2 | Needs connections (`25`) and the manifest (`26`). Agent tool use needs the catalogue to have tools worth choosing. |
| 4–5 | Advanced nodes | `31` | Loops and sub-workflows make the integration demos compelling |
| 5 | Human-in-the-loop, comments & notifications | `32`, `29` | Both need the notification centre, so they're built together |
| 5 | Fair queue & quotas | `33` | Only meaningful once several tenants are generating load |
| 6 | Run operations, audit log, polish, demo seed | `35`, `34`, `36` | Polish goes last so it isn't redone. The demo seed script comes right before the presentation. |

MCP and live mode add about half a week to a week of work. To hold the phase to 6 weeks, `34-audit-log` and the non-essential parts of `36` are cut first.

---

## Acceptance: check scripts

This follows phase 2's practice of writing acceptance criteria as scripts that can be run, not prose. New suites:

| Command | Covers |
|---|---|
| `npm run check:tenancy` | `22`–`24`. For **every** tenant-scoped route, a request from a foreign workspace returns 404. Every role/permission matrix cell is enforced. A socket can't join a foreign run or workflow room. A foreign tenant never gets a cache hit. |
| `npm run check:collab` | `28`. Two to three socket clients send conflicting ops concurrently and all converge on an identical graph. Soft locks work. A late joiner receives the snapshot plus ops. |
| `npm run check:versions` | `30`. Triggers run the published version, not the draft. Restore works. `run.versionId` is recorded. |
| `npm run check:integrations` | `25`–`27`, run with `INTEGRATIONS_LIVE=false` so results are deterministic. Every manifest validates. Every sandbox action is stateful (write, then read it back). Secrets never appear in any API response or run log. |
| `npm run check:http` | C3. A real call to a local test server works when the dev flag is on and is blocked when it's off. The guard blocks `127.0.0.1`, `10.x`, `169.254.169.254`, `[::1]`, `::ffff:127.0.0.1`, a DNS name that resolves privately, and a public-to-private redirect. The 1 MB cap and timeout apply. `4xx` is permanent and `5xx`/`429` retry. |
| `npm run check:mcp` | `37`. Uses the bundled demo server over stdio and HTTP. Covers discovery, calls, `isError` being permanent, a non-allowlisted stdio command being rejected, and a remote URL hitting the SSRF guard. The mock agent picks and calls an MCP tool through the queue. |
| `npm run check:engine` (extended) | `31`, `32`, `35`. Loop, merge, sub-workflow depth guard, error branch, approval pause/resume across a simulated restart, retry-from-failed. |
| `npm run check:queue` | `33`. Round-robin fairness under a lopsided load, per-tenant caps, quota rejection. |
| `npm run check:approvals` | `32`. Pause and resume, concurrent decisions, timeout outcome, signed links, resume after a restart, the interrupted-run reconciler. |
| `npm run check:runs` | `35`. Re-run replays the recorded graph, retry-from-failed reuses upstream results, filters and cursor pagination, the shared run whitelist. |
| `npm run check:audit` | `34`. Every audited action writes one redacted event, updates and deletes are refused, filters and pagination work. |
| `npm run check:integrations:live` | `27`. Optional live smoke tests against real Slack, Discord and GitHub. They skip unless the `*_TEST_*` env vars are set, and aren't part of `check:all`. |
| `npm run check:all` | `36`. Runs every suite above against a throwaway database; used by the GitHub Actions CI. |

The existing six suites must keep passing throughout. `check:tenancy` is the most important new suite, playing the role `check:engine` did in phase 2.

---

## Demo script (what the final presentation shows)

1. Two browsers: **Alice** (Owner) and **Bob** (Editor) are in workspace *Acme*. A third browser, **Carol**, is in *Globex*.
2. Alice invites Bob. The invite appears in the Outbox, Bob accepts, and his avatar appears on Alice's canvas.
3. Both edit the same workflow live: cursors, a soft lock on the node Bob is configuring, and a comment with `@alice` that pings her notification bell.
4. The workflow is **Stripe "Payment failed" → Agent (tools: MCP `lookup_customer`, HTTP Request) → Condition → Approval → Slack (live) + GitHub issue**. Alice publishes it as v3.
5. "Send test event" fires the Stripe trigger. The monitor shows the agent calling the MCP tool and making a **real HTTP call**. The run pauses at Approval, Bob approves from his notification, and a real message lands in a real Slack channel.
6. Carol sees none of this, and her direct API calls with Acme IDs return 404.
7. Wrap-up: the version diff between v2 and v3, the audit log, the Usage page, and the fair queue keeping Acme's 30-branch loop from starving Globex.

---

## Non-goals for phase 3

- **External infrastructure** of any kind (Redis, message brokers, Docker, Kubernetes, managed auth or email). Unchanged from `CLAUDE.md`.
- **CRDT libraries (Yjs, Automerge).** A workflow graph is a set of discrete entities, and per-field last-writer-wins with server sequencing is enough for it. Hand-building the sync is the learning point, the same way the queue was.
- **OAuth**, both for user login (SSO/SAML) and for integrations. Credentials are API keys and webhook URLs only.
- **Real billing or payments.** Plans exist to drive quotas. Nothing gets charged.
- **Real email delivery.** Invites and the SMTP integration write to the Outbox.
- **Horizontal scaling.** The collaboration hub, queue and cache stay single-process. Surviving a restart is scoped to *waiting* runs only (`32`).
- **A secure code sandbox.** The Code node runs `node:vm` with a timeout, documented as unsafe for untrusted tenants. That's acceptable only because this isn't a hosted service.
- **Mobile layouts** beyond "doesn't break."
- **AgentFlow as an MCP server** (exposing published workflows as tools for Claude Code or other agents). Considered and dropped. It could be added later on top of `24`'s API keys.
- **MCP resources, prompts, sampling and elicitation.** Phase 3 uses MCP **tools** only.
- **Tenant-defined stdio MCP servers.** Local servers come only from the operator allowlist (C4).
- **The Claude API's built-in MCP connector** as the tool-use path. See `37` §2 for why.

---

## Open questions (defaults assumed unless changed)

| Question | Assumed default |
|---|---|
| Which live integrations get tested against real services for the demo? | HTTP Request (always live), Slack and Discord webhooks. GitHub only if a spare PAT and repo are available. |
| Which public remote MCP server is used in the demo? | To be chosen and tested in week 4. The bundled demo server covers the story if none turns out to be reliable. |
| Should agents run on the real model (`AGENT_PROVIDER=anthropic`) for the final demo? | Mock by default, with a real-model run rehearsed once. The agent tool-use loop is the first real test of `LLMAgentProvider` (report §14.7). |
| Can one user belong to several workspaces? | Yes, with a switcher. Every user also gets a Personal workspace at registration. |
| Is the phase-2 share link (`18`) still per workflow? | Yes. A workspace Admin can turn off public sharing for the whole workspace. |
| How long is the phase? | 6 weeks, per the build order. If it's shorter, Tier 3 is dropped first, then `33` and `29`. |

**Next step after sign-off:** amend `CLAUDE.md` for C1–C4, add a "Milestone 4 — Phase 3" section to `spec/README.md`, and write specs `22`–`37`, starting with `22` and `24`. The live HTTP tool (C3) can be built right away, since it doesn't depend on any other spec.
