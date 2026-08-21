# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project overview

This is **AgentFlow**, a solo, 3+ month internship project: a MERN-stack AI agent orchestration & workflow automation platform — a visual builder for wiring "agents" and "tools" into workflows, executed by a backend graph engine with async job processing, caching, and real-time monitoring.

Full feature scope, priorities (MVP vs stretch), data models, and architecture live in **`PRODUCT.md`** — read it before proposing or implementing any feature. Do not duplicate that feature list here; this file is about *how* to build, not *what* to build.

## Critical constraints (do not violate without explicit user request)

- **Agents run through a pluggable `AgentProvider`, mocked by default.** Never call an LLM API directly from execution-engine or route code. All agent execution must go through an `AgentProvider` interface with two implementations: `MockAgentProvider` (default — rule/template logic, artificial `await delay(ms)` latency, randomized/canned outputs) and `LLMAgentProvider` (real LLM call, e.g. Anthropic). Which one is active is selected purely by env config (`AGENT_PROVIDER=mock|anthropic`, `ANTHROPIC_API_KEY`), read in one place (e.g. a provider factory), never hardcoded or branched on ad hoc throughout the codebase. Tools remain mocked in both cases — only agent "reasoning" is swappable.
- **No external infra.** Do not introduce Redis, Kafka/RabbitMQ, Docker, Kubernetes, or any managed queue/cache service. The job queue and cache are implemented in-process in the Node server (custom worker-pool/EventEmitter queue, Map-based or `node-cache` TTL cache). If a task seems to need Redis, implement the in-memory equivalent instead.
- **This is a learning project, not production software.** Favor clear, readable orchestration logic over scalability/hardening concerns (no need for horizontal scaling, no rate limiting, no observability stack). Don't add production-grade defensive code for scenarios that can't occur in this single-instance, single-user-at-a-time context.

## Repo structure

Not yet scaffolded. Expected shape once code exists:

```
client/   # React (Vite) app — workflow builder canvas, monitor UI, dashboard
server/   # Express app — REST API, execution engine, Socket.io server
```

Keep frontend and backend as sibling top-level folders (not a monorepo tool like Turborepo/Nx — unnecessary overhead for this scope).

## Tech stack

**Frontend:** React (Vite), React Flow (canvas/graph editor), Zustand or Redux Toolkit, Socket.io-client, Tailwind CSS, Recharts (analytics).

**Backend:** Node.js + Express, MongoDB + Mongoose, Socket.io (server), node-cron (scheduled triggers), JWT auth, a custom in-process job queue, a custom in-process TTL cache, an `AgentProvider` abstraction (mock by default; Anthropic SDK only loaded/required when `LLMAgentProvider` is actually selected — don't add it as a hard dependency otherwise).

Do not suggest swapping the queue/cache for a heavier equivalent (e.g., BullMQ+Redis) unless the user explicitly asks to upgrade that piece later. The agent provider is the one piece of this stack that's *meant* to be swappable — see above.

## Conventions

- **Execution engine lives apart from route handlers.** Graph traversal / node dispatch logic belongs in its own module (e.g. `server/src/engine/`), not inline in Express routes — routes should just trigger/query runs.
- **Mocked node behavior** (agents and tools) should each simulate: (1) artificial latency, (2) occasional simulated failure (for retry/backoff to have something to do), (3) a plausible-looking canned/templated output relevant to the node's configured role. This applies regardless of which `AgentProvider` is active — `LLMAgentProvider` still goes through the same retry/queue/cache machinery as the mock.
- **Socket.io event names** should be consistent and namespaced by concern once defined, e.g. `run:started`, `node:update`, `run:completed` — establish this convention in the first real implementation and keep it consistent afterward.
- **Cache and queue are singletons** within the Node process — no need to design them as swappable/pluggable backends; that abstraction isn't needed at this scope.
- **Env config for the agent provider** belongs in a single `.env`-driven config module (e.g. `server/src/config/agentProvider.js`), read once at startup — not scattered `process.env` checks across the codebase. Never commit a real API key; `.env` stays gitignored and an `.env.example` documents `AGENT_PROVIDER` / `ANTHROPIC_API_KEY` as placeholders.

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

If the client doesn't start on port 5173 (something else is holding it), update `CLIENT_ORIGIN` in `server/.env` to match whatever port Vite actually picked, so CORS keeps working.

## Where to look first

- Check `PRODUCT.md` for overall feature scope and priority (MVP vs stretch) before implementing something new — it's the source of truth for product decisions.
- Check `PHASE_2_SCOPE.md` for the current phase's scope, build order, and an audit of which
  Milestone 3 features are already part-built in the tree — several are, so don't treat them as greenfield.
- Check `spec/README.md` and the matching numbered file in `spec/` for the detailed contract (data model, API routes, socket events, UI behavior, acceptance criteria) of the specific feature you're implementing, before writing code for it.
