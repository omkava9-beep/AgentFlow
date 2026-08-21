# Implementation Plans

Each file is a task checklist for building one spec from `../spec/`, split into **Backend Tasks**, **Frontend Tasks**, and **Verification**. Work through these in order — each depends on the ones before it (see each file's "Depends on" line).

Check off tasks as you go; treat this as a living to-do list, not a fixed document — adjust freely as you learn things during implementation.

## Build order

| Plan | Covers |
|---|---|
| [00-project-setup](00-project-setup.md) | Scaffold `client/` + `server/`, install deps, base app shells |
| [01-auth](01-auth.md) | JWT auth, register/login, protected routes |
| [02-workflow-builder-canvas](02-workflow-builder-canvas.md) | React Flow canvas, node types, cycle prevention |
| [03-node-configuration-panel](03-node-configuration-panel.md) | Per-node config UI |
| [04-workflow-persistence](04-workflow-persistence.md) | Workflow CRUD API + Dashboard |
| [05-agent-tool-providers](05-agent-tool-providers.md) | Mock/LLM `AgentProvider`, `ToolRegistry` |
| [06-execution-engine](06-execution-engine.md) | DAG execution, `Run` model |
| [07-async-job-queue](07-async-job-queue.md) | In-process job queue, retry/backoff |
| [08-in-memory-cache](08-in-memory-cache.md) | TTL cache for tool calls |
| [09-realtime-monitoring](09-realtime-monitoring.md) | Socket.io live run updates |
| [10-manual-run-trigger](10-manual-run-trigger.md) | "Run" button → run creation |
| [11-execution-history](11-execution-history.md) | Past runs list + detail |
| [12-scheduled-triggers](12-scheduled-triggers.md) | Cron-based recurring runs *(stretch)* |
| [13-webhook-trigger](13-webhook-trigger.md) | External HTTP trigger *(stretch)* |
| [14-analytics-dashboard](14-analytics-dashboard.md) | Charts over run history *(stretch)* |
| [15-workflow-templates](15-workflow-templates.md) | Save/clone workflow shapes *(stretch)* |
| [16-agent-handoff](16-agent-handoff.md) | Dynamic agent delegation *(stretch)* |
| [17-failure-injection](17-failure-injection.md) | Configurable simulated failure rate *(stretch)* |
| [18-rbac](18-rbac.md) | Read-only share links *(stretch)* |

## How to use this alongside `spec/`

- `spec/XX-*.md` answers **what** to build and **why** (contracts, data shapes, acceptance criteria).
- `plan/XX-*.md` (this folder) answers **what order to do the work in** — concrete backend/frontend tasks to check off.
- When in doubt about behavior while implementing a task, go back to the matching `spec/` file — it's the source of truth for the contract; this plan is the source of truth for sequencing.
