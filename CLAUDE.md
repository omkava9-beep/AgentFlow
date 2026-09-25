# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project overview

This is **AgentFlow**, a solo, 3+ month internship project: a MERN-stack AI agent orchestration & workflow automation platform — a visual builder for wiring "agents" and "tools" into workflows, executed by a backend graph engine with async job processing, caching, and real-time monitoring.

Phases 1–2 built it for a single user. **Phase 3 (the final phase) makes it multi-tenant and collaborative, with real integrations** — workspaces, roles, live co-editing, a credential vault, ~20 integrations (live by default, sandboxed as a fallback) and MCP tool use. It should *feel* like production software without being production-grade.

Full feature scope, priorities (MVP vs stretch), data models, and architecture live in **`PRODUCT.md`** — read it before proposing or implementing any feature. Do not duplicate that feature list here; this file is about *how* to build, not *what* to build.

## Critical constraints (do not violate without explicit user request)

- **Agents run through a pluggable `AgentProvider`, mocked by default.** Never call an LLM API directly from execution-engine or route code. All agent execution must go through an `AgentProvider` interface (`run()` + the engine-driven `step()`): `MockAgentProvider` (default — rule/template logic, artificial `await delay(ms)` latency, randomized/canned outputs), `OpenAIAgentProvider` (Chat Completions with function calling, `openai` SDK — used both for OpenAI and for **OpenRouter**, the free-tier provider this project uses: `openrouter/free` or any `:free` model, via its OpenAI-compatible endpoint) and `LLMAgentProvider` (Anthropic, kept as an alternative). Which one is active is selected purely by env config (`AGENT_PROVIDER=mock|openrouter|openai|anthropic`, plus `OPENROUTER_API_KEY` / `OPENROUTER_MODEL`, `OPENAI_API_KEY` / `OPENAI_MODEL`, or `ANTHROPIC_API_KEY`), read in one place (`server/src/config/agentProvider.js`), never hardcoded or branched on ad hoc throughout the codebase. SDKs are imported lazily. Check scripts always force `AGENT_PROVIDER=mock`; `npm run try:llm` is the one script that spends real tokens.
- **Integrations are live by default, sandboxed as a fallback** (approved for phase 3, supersedes "tools remain mocked"). Every integration action has a `sandbox` implementation (latency, occasional simulated failure, realistic output, per-workspace state) and, where supported, a `live` one. Live runs whenever the connection has credentials and `INTEGRATIONS_LIVE` is not `false`; that flag is read once in the integrations config module — never branched on ad hoc. Tests/check scripts run with `INTEGRATIONS_LIVE=false` for determinism. Agent reasoning is a separate switch: `AGENT_PROVIDER` stays `mock` by default.
- **All outbound network calls go through the shared SSRF-guarded client**, `server/src/net/safeRequest.js` (spec `27`). Never call `fetch`/`http.request` directly from integration, tool, or MCP code. The guard validates the resolved IP at connect time, blocks loopback/private/link-local/metadata ranges, re-checks every redirect hop, and enforces timeout and size caps. `HTTP_TOOL_ALLOW_PRIVATE_NETWORKS=true` is a local-dev escape hatch only.
- **MCP: tools only, client only.** Remote MCP servers (Streamable HTTP) go through the SSRF guard. Local (stdio) MCP servers come **only** from the operator allowlist `server/mcp-servers.json` — never spawn a command, args, or env supplied by a tenant. `@modelcontextprotocol/sdk` is imported lazily, like the Anthropic SDK.
- **Tenant isolation is mandatory.** Every tenant-owned document carries `workspaceId`. Controllers reach tenant data only through the scoped helpers from spec `22` (never a bare `Model.findById` / `Model.find` on tenant data). A resource in another workspace returns **404**, never 403 — don't confirm it exists. Every Socket.io room join is authorized against membership (spec `24`). Cache keys include `workspaceId`. Secrets are encrypted at rest, write-only over the API, and redacted from logs and run outputs.
- **No external infra.** Do not introduce Redis, Kafka/RabbitMQ, Docker, Kubernetes, or any managed queue/cache/auth/email service. The job queue, cache, cron registry, collaboration hub and MCP connection pool are implemented in-process in the Node server. If a task seems to need Redis, implement the in-memory equivalent instead.
- **Still a learning project, not production software.** Favor clear, readable orchestration logic. Multi-user and multi-tenant are now real scenarios, so isolation and secret-handling code is in scope — but scalability/hardening beyond that is not: no horizontal scaling, no rate limiting, no observability stack. Don't add defensive code for scenarios that can't occur in a single-instance deployment.

## Repo structure

```
client/   # React (Vite) app — workflow builder canvas, monitor UI, dashboard, settings
server/   # Express app — REST API, execution engine, Socket.io server
spec/     # numbered feature specs (the contract for each feature)
plan/     # build plans for phases 1–2
```

Keep frontend and backend as sibling top-level folders (not a monorepo tool like Turborepo/Nx — unnecessary overhead for this scope).

## Tech stack

**Frontend:** React (Vite), React Flow (canvas/graph editor), Zustand, Socket.io-client, Tailwind CSS, Recharts (analytics).

**Backend:** Node.js + Express, MongoDB + Mongoose, Socket.io (server), node-cron (scheduled triggers), JWT auth, a custom in-process job queue, a custom in-process TTL cache, an `AgentProvider` abstraction (mock by default; the `openai` SDK — or `@anthropic-ai/sdk` for the alternative provider — only loaded when that provider is selected), an integration registry with sandbox/live implementations, `node:crypto` (AES-256-GCM) for the credential vault, and `@modelcontextprotocol/sdk` (lazy) for MCP.

Do not suggest swapping the queue/cache for a heavier equivalent (e.g., BullMQ+Redis) unless the user explicitly asks to upgrade that piece later. Don't swap the hand-built collaboration sync for a CRDT library (Yjs/Automerge) either — building it is the point, same as the queue.

## Conventions

- **Execution engine lives apart from route handlers.** Graph traversal / node dispatch logic belongs in its own module (`server/src/engine/`), not inline in Express routes — routes should just trigger/query runs.
- **Nothing that waits holds a queue slot.** Only work (an agent turn, a tool/integration call, a code node) is a queue job. Orchestration (loops, sub-workflows, delays, merges, approvals, agent tool loops) is awaited by the engine, never inside a job. Otherwise nested waits deadlock the bounded pool. See specs `31`, `32`, `33`, `37`.
- **A run replays the graph it recorded** (`versionId`, or a draft snapshot), never the current draft. Re-run, retry-from-failed and the monitor all read the run's own graph (specs `30`, `35`).
- **Every run starts through `createAndStartRun()`** (`server/src/services/runService.js`) regardless of trigger — manual, schedule, webhook, event, API. Quotas, version pinning and tenant tagging are enforced there, once.
- **Sandbox node behavior** (mock agents and sandbox integration actions) should each simulate: (1) artificial latency, (2) occasional simulated failure (for retry/backoff to have something to do), (3) a plausible-looking output relevant to the node's configured role. Live adapters and `LLMAgentProvider` go through the same retry/queue/cache machinery. Map live errors onto the queue: 4xx → `PermanentFailure`, 5xx/429/timeouts → retryable.
- **Socket.io event names** are namespaced `concern:verb` — `run:started`, `node:update`, `run:completed`, `queue:stats`, `workspace:subscribe`, `presence:join`, `collab:op`, `notification:new`, `agent:tool_call`. Keep new events consistent with this.
- **Tenant-scoped API requests** carry `X-Workspace-Id`; client routes are prefixed `/w/:slug/`. External callers (events, public API) address a workspace by slug in the path and authenticate with a workspace API key.
- **Permissions come from one matrix** (spec `23`) on the server; the client renders from the permission list the server sends, never from its own copy of the matrix.
- **Cache and queue are singletons** within the Node process — no need to design them as swappable/pluggable backends.
- **Env config** belongs in the `.env`-driven config modules under `server/src/config/` (e.g. `agentProvider.js`, `env.js`), read once at startup — not scattered `process.env` checks. Never commit a real API key or `SECRETS_MASTER_KEY`; `.env` stays gitignored and `.env.example` documents every variable with placeholders.
- **Acceptance criteria are check scripts** (`npm run check:*`), not prose. Each spec's criteria should be runnable; `check:tenancy` must pass before any feature that adds a tenant-scoped route is considered done.

## Commands

Requires a local MongoDB running on `mongodb://127.0.0.1:27017` (or update `server/.env`'s `MONGODB_URI`).

```
# backend (http://localhost:4000)
cd server && cp .env.example .env   # first time only
npm install                          # first time only
npm run dev

# frontend (http://localhost:5173, or next free port)
cd client && cp .env.example .env   # first time only
npm install                          # first time only
npm run dev
```

```
# demo data: Acme + Globex, alice/bob/victor/carol (password demo-password), 14 days of runs
cd server && npm run seed:demo

# every acceptance suite on a throwaway server + DB (what CI runs)
cd server && npm run check:all          # or: npm run check:<suite>
```

If the client doesn't start on port 5173 (something else is holding it), update `CLIENT_ORIGIN` in `server/.env` to match whatever port Vite actually picked, so CORS keeps working.

## Where to look first

- Check `PRODUCT.md` for overall feature scope — it's the source of truth for product decisions.
- Check **`PHASE_3_SCOPE.md`** for the current (final) phase: approved constraint changes (C1–C4), the audit of latent multi-tenant bugs, spec tiers, build order and progress.
- Check `PHASE_2_SCOPE.md` for what phase 2 built and its check scripts.
- Check `spec/README.md` and the matching numbered file in `spec/` for the detailed contract (data model, API routes, socket events, UI behavior, acceptance criteria) of the specific feature you're implementing, before writing code for it. Phase-3 specs are `22`–`37`; where one revises an earlier spec, the earlier file carries a "Revised in phase 3" pointer — follow it before relying on the earlier contract.
