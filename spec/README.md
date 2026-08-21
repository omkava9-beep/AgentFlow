# Feature Specs

Each file is a self-contained spec for one feature from `../PRODUCT.md`: goals, non-goals, data model, API/socket contract, UI behavior, edge cases, and acceptance criteria. Build roughly in numeric order — later specs depend on earlier ones (each file's "Depends on" line says which).

## Milestone 1 — Foundation

| Spec | Feature |
|---|---|
| [01-auth](01-auth.md) | JWT auth, user-scoped workflows |
| [02-workflow-builder-canvas](02-workflow-builder-canvas.md) | Visual DAG canvas (React Flow) |
| [03-node-configuration-panel](03-node-configuration-panel.md) | Per-node config UI |
| [04-workflow-persistence](04-workflow-persistence.md) | Save/load workflows, Dashboard |

## Milestone 2 — Execution

| Spec | Feature |
|---|---|
| [05-agent-tool-providers](05-agent-tool-providers.md) | Mock/real `AgentProvider` abstraction + mock `ToolRegistry` |
| [06-execution-engine](06-execution-engine.md) | DAG graph walker / run execution |
| [07-async-job-queue](07-async-job-queue.md) | In-process job queue, retry/backoff |
| [08-in-memory-cache](08-in-memory-cache.md) | TTL cache for tool calls |
| [09-realtime-monitoring](09-realtime-monitoring.md) | Socket.io live run updates |
| [10-manual-run-trigger](10-manual-run-trigger.md) | "Run" button → run creation |
| [11-execution-history](11-execution-history.md) | Past runs list + detail view |

## Milestone 3 — Triggers, Analytics & Polish (Stretch)

| Spec | Feature |
|---|---|
| [12-scheduled-triggers](12-scheduled-triggers.md) | Cron-based recurring runs |
| [13-webhook-trigger](13-webhook-trigger.md) | External HTTP trigger |
| [14-analytics-dashboard](14-analytics-dashboard.md) | Charts over run history |
| [15-workflow-templates](15-workflow-templates.md) | Save/clone reusable workflow shapes |
| [16-agent-handoff](16-agent-handoff.md) | Dynamic agent-to-agent delegation |
| [17-failure-injection](17-failure-injection.md) | Configurable simulated tool failure rate |
| [18-rbac](18-rbac.md) | Read-only share links |

## Conventions used across specs

- **Status** — MVP or Stretch, matching `PRODUCT.md`'s feature split.
- **Milestone** — which of the three rough build phases it belongs to.
- **Depends on** — other specs that should exist first, functionally or structurally.
- Specs describe *behavior and contracts* (data shapes, API routes, socket events, acceptance criteria) — not file-by-file implementation steps. Implementation details are decided at build time, guided by `CLAUDE.md`'s conventions.
