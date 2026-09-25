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

## Milestone 3 — Triggers, Analytics & Polish (Phase 2)

Phase 1 shipped `01`–`11` and left structural stubs for most of `12`–`18`. See
[`../PHASE_2_SCOPE.md`](../PHASE_2_SCOPE.md) for what already exists per spec, the
build order, and how the "Coming Soon" scaffolding gets retired.

| Spec | Feature |
|---|---|
| [12-scheduled-triggers](12-scheduled-triggers.md) | Cron-based recurring runs |
| [13-webhook-trigger](13-webhook-trigger.md) | External HTTP trigger |
| [14-analytics-dashboard](14-analytics-dashboard.md) | Charts over run history |
| [15-workflow-templates](15-workflow-templates.md) | Save/clone reusable workflow shapes |
| [16-agent-handoff](16-agent-handoff.md) | Dynamic agent-to-agent delegation |
| [17-failure-injection](17-failure-injection.md) | Configurable simulated tool failure rate |
| [18-rbac](18-rbac.md) | Read-only share links |

### Phase 2 extensions

Specs that deepen phase-1 features rather than adding new ones.

| Spec | Feature |
|---|---|
| [19-engine-parallelism-and-control](19-engine-parallelism-and-control.md) | Concurrent fan-out, fan-in/skip semantics, per-node retry, run cancellation |
| [20-builder-ux](20-builder-ux.md) | Undo/redo, copy-paste, edge label editing, live graph validation |
| [21-extended-tool-catalog](21-extended-tool-catalog.md) | Declarative tool config schemas, 4 new mocked tools, External Event trigger |

## Milestone 4 — Multi-tenancy, Collaboration & Integrations (Phase 3)

The final phase. See [`../PHASE_3_SCOPE.md`](../PHASE_3_SCOPE.md) for the approved constraint
changes (C1–C4), the audit of latent multi-tenant bugs, tiers, and build order. All sixteen specs are written; `37` is numbered last because it was added after `22`–`36` were drafted.

| Spec | Feature | Tier | Written / Implemented |
|---|---|---|---|
| [22-workspaces-multitenancy](22-workspaces-multitenancy.md) | Workspaces, memberships, tenant-scoped data access, migration | 1 | ✅ / ✅ |
| [23-roles-and-invitations](23-roles-and-invitations.md) | Permission matrix, invitations, Outbox, members management | 1 | ✅ / ✅ |
| [24-socket-auth-and-namespaced-events](24-socket-auth-and-namespaced-events.md) | Socket JWT + room authorization, workspace API keys, per-workspace events, public run API | 1 | ✅ / ✅ |
| [25-secrets-and-connections](25-secrets-and-connections.md) | Encrypted credential vault, connections | 1 | ✅ / ✅ |
| [26-integration-framework](26-integration-framework.md) | Integration manifests, sandbox/live implementations | 1 | ✅ / ✅ |
| [27-integration-catalog](27-integration-catalog.md) | ~20 integrations, sandbox store, SSRF-guarded live HTTP | 1 | ✅ / ✅ |
| [28-realtime-collaboration](28-realtime-collaboration.md) | Presence, op-based co-editing, soft locks | 1 | ✅ / ✅ |
| [29-comments-mentions-notifications](29-comments-mentions-notifications.md) | Comment threads, @mentions, notification centre | 2 | ✅ / ✅ |
| [30-workflow-versioning](30-workflow-versioning.md) | Draft/publish, versions, diff, restore | 1 | ✅ / ✅ |
| [31-advanced-nodes](31-advanced-nodes.md) | Transform, code, delay, loop, merge, sub-workflow, error branch | 2 | ✅ / ✅ |
| [32-human-in-the-loop](32-human-in-the-loop.md) | Approval node, `waiting` runs resumable across restart | 2 | ✅ / ✅ |
| [33-fair-queue-and-quotas](33-fair-queue-and-quotas.md) | Per-workspace round-robin queue, plan quotas, usage page | 2 | ✅ / ✅ |
| [34-audit-log](34-audit-log.md) | Append-only audit events | 3 | ✅ / ✅ |
| [35-run-operations](35-run-operations.md) | Re-run, retry from failed node, run search, live analytics | 2 | ✅ / ✅ |
| [36-production-polish](36-production-polish.md) | Command palette, demo seed, settings, status page, CI | 3 | ✅ / ✅ |
| [37-mcp](37-mcp.md) | MCP servers as connections, MCP tool node, agent tool use | 1 | ✅ / ✅ |

## Conventions used across specs

- **Status** — MVP, Stretch, Phase 2 extension, or Phase 3 (with its tier). MVP/Stretch match `PRODUCT.md`'s feature split; "Phase 2 extension" marks a spec that revises an already-shipped feature, so read the spec it extends first.
- **Milestone** — which of the three rough build phases it belongs to.
- **Depends on** — other specs that should exist first, functionally or structurally.
- **Revises** — (phase 3) earlier specs whose contract this one changes; each revised file carries a pointer back.
- Specs describe *behavior and contracts* (data shapes, API routes, socket events, acceptance criteria) — not file-by-file implementation steps. Implementation details are decided at build time, guided by `CLAUDE.md`'s conventions.
