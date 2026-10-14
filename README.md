# AgentFlow

AgentFlow is a visual builder for AI-agent workflows: drag agents, tools and integrations onto a canvas, wire them into a graph, and run it — live, node by node — on a hand-built engine with an async job queue, a TTL cache and a real-time event stream. It's a MERN-stack internship project that aims to *feel* like a production team tool (workspaces, roles, co-editing, ~20 integrations, MCP, approvals, versioning) while running entirely on one Node process and a MongoDB connection string.

- Product scope: [`PRODUCT.md`](PRODUCT.md) · Final-phase scope and decisions: [`PHASE_3_SCOPE.md`](PHASE_3_SCOPE.md) · Feature contracts: [`spec/README.md`](spec/README.md)
- No Redis, Docker, message broker or managed service — the queue, cache, cron registry, collaboration hub and MCP pool are all in-process.

## Features

**Multi-tenancy & teams**
- Workspaces with strict isolation: every tenant document carries `workspaceId`, controllers only read through scoped helpers, and a resource in another workspace is a 404, never a 403 (spec 22).
- Owner / Admin / Editor / Viewer roles from one server-side permission matrix; invitations by link (with a dev **Outbox** instead of real email); live effect of role changes and removals (spec 23).
- Authenticated Socket.io with per-room authorization, workspace API keys, per-workspace events and a small public run API (spec 24).
- Plans with per-workspace queue caps and daily run quotas, a fair round-robin queue, and a Usage page (spec 33). Append-only, redacted audit log (spec 34).

**Collaboration**
- Live co-editing: presence, cursors, per-field last-writer-wins ops over Socket.io, soft locks on the node being configured, autosave, per-user undo (spec 28).
- Comment threads pinned to nodes, `@mentions`, and a cross-workspace notification bell with workflow watching (spec 29).
- Draft/publish versioning with diff, restore and rollback. Triggers always run the **published** version; the Builder's Run is a draft test run; every run records the graph it executed (spec 30).

**Integrations**
- An encrypted credential vault (AES-256-GCM, write-only secrets, redacted from logs and outputs) (spec 25).
- ~20 integrations (Slack, Discord, Teams, Email, Twilio, GitHub, Jira, Linear, Sheets, Notion, Airtable, Database, Stripe, HubSpot, HTTP, Outbound webhook, RSS, AI presets, Knowledge base, MCP). Every one has a **stateful sandbox**; six have **live** adapters, used by default whenever a connection has credentials (`INTEGRATIONS_LIVE=false` turns every live call off) (specs 26–27).
- Every outbound request goes through one **SSRF-guarded client** (`server/src/net/safeRequest.js`): resolved-IP checks at connect time, private/metadata ranges blocked, redirects re-checked, timeouts and size caps.
- Signed inbound provider webhooks (GitHub, Stripe, Slack), "Send test event", RSS polling (spec 27).
- **MCP**: connect remote (Streamable HTTP, through the SSRF guard) or operator-allowlisted local (stdio) MCP servers; their tools appear as nodes, and agents can call them in a tool-use loop (spec 37).

**Engine**
- Readiness-driven DAG execution with bounded concurrency, fan-in/skip semantics, per-node retries and cancellation (spec 19).
- Transform, Code, Delay, Loop, Merge, Sub-workflow and error-branch nodes; nothing that waits ever holds a queue slot (spec 31).
- Human-in-the-loop **Approval** nodes: a waiting run is parked in MongoDB and resumes after a server restart; runs interrupted by a crash are reconciled at boot (spec 32).
- Agents run through a pluggable `AgentProvider` — mock by default; real models via OpenRouter (`AGENT_PROVIDER=openrouter`, free tier), OpenAI (`openai`) or Anthropic (`anthropic`).

## Architecture

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

## Quick start

Requires **Node 22+** (developed on 23) and a local **MongoDB** on `mongodb://127.0.0.1:27017`.

```bash
# backend — http://localhost:4000
cd server
cp .env.example .env
# generate the credential-vault key and paste it into SECRETS_MASTER_KEY= in .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# also set JWT_SECRET to any long random string
npm install
npm run dev

# frontend — http://localhost:5173 (in a second terminal)
cd client
cp .env.example .env
npm install
npm run dev
```

If Vite picks a port other than 5173, set `CLIENT_ORIGIN` in `server/.env` to match so CORS keeps working.

### Demo data

```bash
cd server
npm run seed:demo      # safe to re-run; only ever replaces its own demo data
```

The seed builds the whole demo scenario through the real API: users and roles, the Team plan on Acme, sandbox connections (Stripe, Slack, GitHub, the bundled MCP demo server), the **Payment triage** workflow published as v1–v3, a scheduled report, an error-branch example, a Code node, two workflows from templates, Globex's 30-item **Bulk enrich** loop, 14 days of run history with matching usage, a comment that @mentions Alice, a pending invite, a knowledge base, an API key (printed once), and a **live run parked at an approval waiting for Bob**.

| Account | Password | Role |
|---|---|---|
| `alice@acme.test` | `demo-password` | Owner of **Acme** |
| `bob@acme.test` | `demo-password` | Editor in Acme (the approver) |
| `victor@acme.test` | `demo-password` | Viewer in Acme |
| `carol@globex.test` | `demo-password` | Owner of **Globex** |
| `dana@acme.test` | — | Pending invite (sign up with this address, then open `/outbox`) |

The `.test` TLD is reserved, so these can never be real addresses. Restart a running dev server after seeding so it registers the new schedule.

### Demo walkthrough

1. Sign in as **Alice** in one browser and **Bob** in another (a private window works). Carol, in a third, is in Globex.
2. Settings → Members shows the team; Dana's invite is pending in the Outbox.
3. Open **Payment triage** in both browsers: cursors, avatars, and a soft lock on whichever node the other is configuring. Bob's comment on the approval node has pinged Alice's bell.
4. **History** shows v1 → v3; the diff between v2 and v3 highlights the new GitHub issue and threshold.
5. Bob's **Approvals** page has a waiting refund. Approve it and watch the run finish in the monitor. Or fire a fresh one: Integrations → Stripe → *Send test event* on *Payment failed*, and watch the agent call the MCP `lookup_customer` tool live.
6. To make the Slack step real, edit the Slack connection: paste a real incoming-webhook URL and switch it to **live**.
7. Carol sees none of Acme; her API calls with Acme ids return 404.
8. Wrap up with Settings → Audit log, Settings → Usage & plan, Analytics, and System status (Settings → *System status*). Run Globex's **Bulk enrich** while Acme is busy to see the fair queue at work (the operator view shows both; set `OPERATOR_EMAILS`).

## Running the checks

Acceptance criteria are runnable scripts. One command runs all of them against a throwaway database and a server it starts itself — the same command CI runs:

```bash
cd server
npm run check:all                    # every suite, summary table, non-zero exit on failure
npm run check:all -- --only tenancy,rbac
npm run check:all -- --list
```

| Suite | Covers |
|---|---|
| `engine`, `nodes`, `approvals` | DAG execution, advanced nodes, no-deadlock, approvals and restart resume (specs 19, 31, 32) |
| `tenancy`, `rbac`, `realtime` | Tenant isolation and route inventory, the full permission matrix, socket auth and API keys (22–24) |
| `http`, `integrations`, `catalog`, `inbound`, `mcp` | SSRF guard, connections and vault, the catalogue, inbound webhooks, MCP and agent tool use (25–27, 37) |
| `collab`, `versions`, `comments` | Co-editing convergence and locks, versioning, comments and notifications (28–30) |
| `queue`, `audit` | Fair queue, quotas and usage; the audit log (33, 34) |
| `triggers`, `templates`, `analytics`, `share` | Phase-2 features, updated for workspaces |
| `runs`, `polish` | Run operations and production polish (35, 36) |
| `logic` (client) | Store, collaboration ops, graph validation and form logic — no browser needed |

Suites create users and data, so run them against a throwaway database — `check:all -- --only <suite>` does that for you. To use a server you started yourself, start it with a scratch `MONGODB_URI` and point the suite at it with `BASE=http://localhost:<port>/api npm run check:<suite>` (same `MONGODB_URI` in both shells). CI (`.github/workflows/ci.yml`) runs `check:all` against a MongoDB service container, plus the client's lint, logic checks and build.

## Environment variables

`server/.env` (see `server/.env.example`):

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `4000` | API port |
| `MONGODB_URI` | — | **Required** |
| `JWT_SECRET` | — | **Required, secret** |
| `SECRETS_MASTER_KEY` | — | **Required, secret.** 32 bytes of base64; encrypts stored credentials. Boot fails with a generate command if missing |
| `CLIENT_ORIGIN` | `http://localhost:5173` | CORS origin and base for invite/share/approval links |
| `PUBLIC_BASE_URL` | `http://localhost:<PORT>` | Base for copyable webhook and event URLs |
| `AGENT_PROVIDER` | `mock` | `mock`, `openrouter`, `openai` or `anthropic` |
| `OPENROUTER_API_KEY` | — | Secret; required when `AGENT_PROVIDER=openrouter` ([get one](https://openrouter.ai/keys)) |
| `OPENROUTER_MODEL` | `openrouter/free` | Any OpenRouter model id; free ones end in `:free` — list those with tool support via `npm run try:llm -- --list-free` |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | — / `gpt-5.4-mini` | Required when `AGENT_PROVIDER=openai` |
| `ANTHROPIC_API_KEY` | — | Secret; required when `AGENT_PROVIDER=anthropic` (also `npm install @anthropic-ai/sdk`) |
| `ANTHROPIC_MODEL` | `claude-opus-5` | Model for the LLM provider |
| `INTEGRATIONS_LIVE` | `true` | `false` forces every integration into sandbox |
| `HTTP_TOOL_ALLOW_PRIVATE_NETWORKS` | `false` | Local-development escape hatch for the SSRF guard |
| `HTTP_TOOL_ALLOWED_HOSTS` | — | Optional outbound host allowlist (`*.example.com` supported) |
| `DEFAULT_TOOL_FAILURE_RATE` | `0.1` | Simulated failure rate for sandbox calls |
| `QUEUE_CONCURRENCY` | `8` | Shared worker pool; per-workspace caps come from the plan |
| `QUEUE_MAX_ATTEMPTS` | `3` | Default retries per job |
| `QUEUE_BASE_BACKOFF_MS` | `500` | Retry backoff base (doubles per attempt) |
| `RUN_TIMEOUT_MS` | `120000` | Run deadline (active time only) |
| `CODE_NODE_ENABLED` | `true` | Code nodes run trusted code with server privileges |
| `CODE_NODE_TIMEOUT_MS` / `CODE_NODE_MEMORY_MB` | `1000` / `64` | Code node limits |
| `DELAY_INLINE_MAX_MS` / `DELAY_MAX_MS` | `60000` / `86400000` | Longer delays park the run |
| `LOOP_MAX_ITEMS` / `SUBWORKFLOW_MAX_DEPTH` | `500` / `5` | Loop and nesting limits |
| `COLLAB_FLUSH_DEBOUNCE_MS` / `COLLAB_FLUSH_MAX_MS` / `COLLAB_LOCK_TTL_MS` | `1000` / `5000` / `60000` | Collaboration hub timings |
| `MCP_CALL_TIMEOUT_MS` / `MCP_IDLE_CLOSE_MS` | `30000` / `300000` | MCP call timeout and idle-client close |
| `MCP_ALLOWLIST_PATH` | `mcp-servers.json` | Operator allowlist of local MCP servers (tenants can only pick from it) |
| `AGENT_TOOL_RESULT_MAX_CHARS` | `8000` | Tool output cap before it goes back to the model |
| `APPROVAL_LINK_SECRET` | derived from `JWT_SECRET` | Secret; signs approve/reject links |
| `OPERATOR_EMAILS` | — | Comma-separated emails that see the cross-tenant status view |

`client/.env` (see `client/.env.example`):

| Variable | Default | Notes |
|---|---|---|
| `VITE_API_URL` | `http://localhost:4000/api` | REST base |
| `VITE_SOCKET_URL` | `http://localhost:4000` | Socket.io origin |

## Project layout

```
client/          React (Vite) app — builder canvas, monitor, settings, collaboration client
server/
  src/engine/    DAG executor, node registry, agent tool loop, resume/reconcile
  src/queue/     in-process fair job queue
  src/collab/    collaboration hub (ops, presence, soft locks)
  src/integrations/  registry, manifests, sandbox store
  src/mcp/       MCP pool, allowlist, bundled demo server
  src/net/       the one SSRF-guarded outbound HTTP client
  src/secrets/   credential vault and redaction
  src/tenancy/   scoped queries, permission matrix, workspace delete cascade
  src/scripts/   migrations, seeds and every check suite
  mcp-servers.json   operator allowlist of local MCP servers
spec/            numbered feature specs (the contract for each feature)
```
# AgentFlow
# AgentFlow
# AgentFlow
