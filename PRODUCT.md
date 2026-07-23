# AgentFlow — AI Agent Orchestration & Workflow Automation Platform

*Internship project — full-stack MERN application*

## One-liner

A visual builder where you drag out AI "agents" and "tools" onto a canvas, wire them into workflows, and run them — watching execution happen live, node by node — powered by a hand-built async job queue, in-memory cache, and real-time event stream.

## The Idea

Tools like n8n, Zapier, and newer "agent orchestration" platforms let non-engineers wire together automations visually. This project builds a small version of that idea, purpose-built to demonstrate the backend engineering underneath: event-driven triggers, asynchronous job processing, caching, real-time updates over WebSockets, and a graph execution engine — all the pieces a scalable workflow platform actually needs, built from scratch instead of imported as a managed service.

### What this IS

- A learning-focused, portfolio-worthy full-stack project for an internship.
- A real visual workflow builder (canvas, nodes, edges) backed by a real execution engine.
- A demonstration of orchestration concepts: DAG execution, async queues, caching, pub/sub-style real-time updates, scheduled/event triggers.

### What this is NOT

- **Not production-grade.** No horizontal scaling, no auth hardening beyond JWT basics, no rate limiting/observability stack.
- **No real LLM calls by default.** Agents are *simulated* — their "reasoning" is simple rule/template-based logic (keyword matching, canned responses, randomized outcomes). The project is about orchestrating agents, not prompting them.
- **No external infra.** No Redis, no Kafka/RabbitMQ, no Docker/Kubernetes. The job queue and cache are implemented in-process in Node.js. Everything runs with `npm run dev` and a MongoDB connection string.

This scoping is intentional: it keeps 100% of the engineering effort on orchestration logic — the actual subject of the internship — rather than on deploying and babysitting infrastructure.

### Mock-to-real upgrade path

The mock-vs-real choice for agent "reasoning" should be a **swappable provider, not a hardcoded shortcut**. Agent execution goes through a single `AgentProvider` interface with two implementations:

- `MockAgentProvider` (default) — rule/template-based simulated output, artificial latency, randomized failure.
- `LLMAgentProvider` (opt-in) — calls a real LLM API (e.g. Anthropic) using the agent's configured role/system prompt as the actual prompt.

Which one runs is controlled entirely by environment variables — no code changes needed to switch:

```
AGENT_PROVIDER=mock        # default — no key required
# AGENT_PROVIDER=anthropic
# ANTHROPIC_API_KEY=sk-...
```

This keeps the prototype's default behavior free, fast, and offline-friendly, while leaving a clear, low-effort path to plug in a real model later without redesigning the execution engine.

## Target User / Use Case

A single demo user builds workflows like:

```
[Manual Trigger] → [Tool: Fetch Data] → [Agent: Summarizer] → [Condition: length > 100?]
                                                                 ├─ yes → [Agent: Formatter] → [Tool: Notify]
                                                                 └─ no  → [Tool: Notify]
```

They hit "Run," watch each node light up (pending → running → success/failed) in real time, inspect the output/logs per node, and later review the run in history or on an analytics dashboard. There are no real external customers — this is a self-contained demo environment.

## Core Concepts

| Concept | Meaning |
|---|---|
| **Agent** | A node with a name/role and a "system prompt." Its execution runs through a pluggable `AgentProvider` — by default a mock (simple rule-based branching / fixed-templated output), optionally a real LLM call when `AGENT_PROVIDER` is set. |
| **Tool** | A mocked external capability an agent/workflow can invoke (fake weather API, calculator, fake search). Returns canned or randomized data after an artificial delay — this is what exercises the async/queue/cache machinery. |
| **Workflow** | A DAG (directed acyclic graph) of nodes — agents, tools, conditionals, start/end — connected by edges, authored visually. |
| **Run** | One execution instance of a workflow: overall status, start/end time, and per-node results (status, output, duration, logs). |
| **Trigger** | What starts a run: manual button click, a schedule (cron), or an inbound webhook/event. |

## Feature List

### MVP (target: months 1–2)

- **Auth** — JWT-based register/login; workflows are scoped to their owning user.
- **Visual workflow builder** — canvas (React Flow) to add, connect, and delete nodes: agent, tool, condition, start/end.
- **Node configuration panel** — set an agent's role/mock behavior, a tool's type/mock response, or a condition's expression.
- **Save/load workflows** — persisted to MongoDB as a graph (nodes + edges).
- **Execution engine** — backend graph walker that topologically executes nodes, supporting sequential steps, parallel branches, and conditional branching.
- **Manual run trigger** — a "Run" button kicks off execution with live status.
- **In-memory async job queue** — simulates a real worker pool: bounded concurrency, retry with backoff when a mocked tool "fails."
- **In-memory TTL cache** — caches repeated tool calls within/across runs; UI shows a cache-hit indicator.
- **Real-time monitoring** — Socket.io streams live per-node status and logs to the builder/monitor UI as a run executes.
- **Execution history** — list of past runs, with a per-run detail/timeline view.

### Stretch (months 2–3+)

- **Scheduled triggers** — `node-cron`-based recurring runs.
- **Event/webhook trigger** — an HTTP endpoint that starts a workflow run externally.
- **Analytics dashboard** — success/failure rate, average duration, most-used node types, runs-over-time chart.
- **Workflow templates / duplication.**
- **Agent-to-agent handoff** — an agent's output dynamically selects the next agent to run, simulating multi-agent delegation.
- **Configurable failure injection** — per-tool failure-rate setting, to visibly demonstrate retry/backoff behavior.
- **Basic RBAC** — owner-only editing, shareable read-only view link.

## Tech Stack

**Frontend**
- React (Vite)
- React Flow — canvas/graph editor
- Zustand or Redux Toolkit — client state
- Socket.io-client — live run updates
- Tailwind CSS — styling
- Recharts — analytics dashboard (stretch)

**Backend**
- Node.js + Express
- MongoDB + Mongoose
- Socket.io (server) — real-time event push
- node-cron — scheduled triggers (stretch)
- JWT — auth
- A small in-process job queue (custom, EventEmitter/worker-pool based) — intentionally simplified stand-in for BullMQ/Redis
- A small in-process TTL cache (Map-based, or the `node-cache` package) — intentionally simplified stand-in for Redis
- An `AgentProvider` abstraction (`MockAgentProvider` / `LLMAgentProvider`), selected at runtime via the `AGENT_PROVIDER` env var (see [Mock-to-real upgrade path](#mock-to-real-upgrade-path)); the Anthropic SDK is only an actual dependency once `LLMAgentProvider` is used

**Explicitly not used (by default):** Redis, Kafka/RabbitMQ, Docker/Kubernetes. Real LLM API calls are supported but opt-in via env config, never the default.

## High-Level Architecture

```
Client (Builder UI + Monitor UI)
      │  REST (CRUD workflows/runs, auth)
      │  Socket.io (live run events)
      ▼
Express API  ──▶  Execution Engine (graph walker)
                        │        │
                 in-memory   in-memory
                   queue        cache
                        │
                        ▼
                    MongoDB (users, workflows, runs)
```

The execution engine is the heart of the project: given a saved workflow graph and a run request, it walks the DAG, dispatches each node to the in-memory job queue, applies the cache where a tool call repeats, and emits Socket.io events as each node transitions state — which the frontend renders live.

## Data Models (MongoDB collections)

- **User** — `email`, `passwordHash`, `createdAt`
- **Workflow** — `ownerId`, `name`, `nodes[]` (id, type, config), `edges[]` (source, target, condition?), `createdAt`, `updatedAt`
- **Run** — `workflowId`, `status` (pending/running/success/failed), `startedAt`, `finishedAt`, `nodeResults[]` (nodeId, status, output, durationMs, logs[])
- **Template** *(stretch)* — a reusable saved workflow shape, cloneable into a new Workflow

## Pages / Screens

1. **Login / Register**
2. **Dashboard** — list of the user's workflows
3. **Workflow Builder** — canvas + node config panel
4. **Run Monitor** — live view of an in-progress run
5. **Run History** — list of past runs + detail view
6. **Analytics** *(stretch)* — charts over run/workflow data

## Suggested Milestones

- **Month 1** — Auth, workflow builder UI (canvas + config panel), save/load workflows to MongoDB.
- **Month 2** — Execution engine, in-memory queue + cache, live monitoring via Socket.io, run history.
- **Month 3** — Scheduled/event triggers, analytics dashboard, templates, polish and stretch features.
