# Phase 2 — Scope (Second Presentation)

Phase 1 shipped the full core loop (specs `01`–`11`): register → build → configure → save → run → watch live → review in history. Phase 2 does two things:

1. **Turns every "Coming Soon" badge live** — the Milestone 3 specs `12`–`18`.
2. **Deepens what phase 1 built** — three new extension specs (`19`–`21`) that make the engine genuinely concurrent, the builder genuinely usable, and the tool catalog genuinely broad.

By the end of phase 2 there should be no `COMING_SOON_FEATURES` flag left set to `true`.

## What already exists (audit against the current tree)

Phase 1 deliberately left structural stubs behind, so several Milestone 3 specs are part-built. Read this before assuming a feature is greenfield.

| Spec | Already in the tree | Still to build |
|---|---|---|
| `12-scheduled-triggers` | `Workflow.schedule { cronExpression, enabled }` in the model; `node-cron` installed | Routes, cron registry, startup re-registration, UI panel |
| `13-webhook-trigger` | `Workflow.webhook { token, enabled }`; `routes/hooks.js` mounted, returns 404 | Token generation, real handler, payload → Start input, UI |
| `14-analytics-dashboard` | `recharts` installed | Aggregation endpoint, page, route, nav item |
| `15-workflow-templates` | `models/Template.js`; `npm run seed:templates` script entry | `src/scripts/seedTemplates.js` (**referenced but missing**), routes, controller, gallery UI |
| `16-agent-handoff` | **Engine + MockAgentProvider already implement it** (`isHandoff`, `candidates`, `handoffTarget`, edge-label matching in `executeRun.js`) | Config-panel editor, edge-label sync, monitor highlight, `nodeResults.handoffTarget` persistence |
| `17-failure-injection` | `withMockBehavior()` already reads `config.mockOverrides.failureRate` and throws `SimulatedToolFailure` | Un-disable the slider, persist the override, distinct log phrasing, cache interaction (see `19`) |
| `18-rbac` | `Workflow.shareToken`; `routes/shared.js` mounted, returns 404 | Share/unshare routes, public read endpoint, read-only `/shared/:token` page |

So the backend data model for `12`, `13`, and `18` is done, and `16` is mostly done. The genuinely new work is concentrated in `14`, `15`, and the three extension specs.

## New extension specs

| Spec | Covers |
|---|---|
| [`19-engine-parallelism-and-control`](spec/19-engine-parallelism-and-control.md) | Concurrent fan-out, correct fan-in/skip semantics, per-node retry, run cancellation, queue bug fixes |
| [`20-builder-ux`](spec/20-builder-ux.md) | Undo/redo, copy-paste/duplicate, edge label editing, live graph validation panel |
| [`21-extended-tool-catalog`](spec/21-extended-tool-catalog.md) | Flip the 4 gated tool types live, declarative tool config schemas, External Event trigger |

`19` is the load-bearing one. The current engine walks the topological order **strictly sequentially**, awaiting each node's queue job before starting the next — which means `QUEUE_CONCURRENCY` is effectively 1 and the hand-built job queue, the centrepiece of the product brief, never actually demonstrates bounded concurrency. Fixing that is the single highest-value change in phase 2.

## Build order

Each step is safe to demo on its own; ordering is by dependency, not by spec number.

1. **`19` — engine & queue.** Do this first: it fixes correctness bugs the later features would otherwise inherit, and it unblocks per-node retry config for `17`.
2. **`17` — failure injection.** Small once `19` lands (the handler logic already exists); mostly un-disabling UI and settling the cache interaction.
3. **`20` — builder UX.** Edge-label editing here is a prerequisite for `16`'s candidate sync.
4. **`16` — agent handoff.** Finish the UI half of an already-working engine feature.
5. **`12` + `13` + `21`'s event trigger.** All three are the same shape — "something other than a button starts a run" — so build the shared run-trigger entry point once and fan out.
6. **`21` — tool catalog.** Declarative tool config schemas, then the four new mocked handlers.
7. **`15` — templates.** Includes writing the missing `seedTemplates.js`.
8. **`14` — analytics.** Last, because it is the most rewarding to demo once there is a real backlog of runs to aggregate over.
9. **`18` — share links.** Independent of everything else; can slot in anywhere, but it is the least interesting to demo.

## Retiring the Coming Soon scaffolding

`client/src/comingSoon.js` and `client/src/comingSoonCatalog.js` were built so flipping a feature live is a one-line change. Phase 2 should:

- Flip each `COMING_SOON_FEATURES` key to `false` as its spec lands, and delete the whole module once all six are false — leaving a dead all-`false` config is worse than removing it.
- Replace `ACTION_TYPES` in `comingSoonCatalog.js` with the live `GET /api/tools` response (see `21`), so the tool list has exactly one source of truth: the server-side `ToolRegistry`.
- Keep `TRIGGER_TYPES` as a static catalog — triggers are a fixed, small set that the server doesn't enumerate.

## Non-goals for phase 2

- Multi-user / team features beyond `18`'s single read-only share link.
- Real outbound network calls from tool nodes — the new `http-request` tool stays mocked on purpose (see `21`).
- Real LLM calls as the default. `LLMAgentProvider` remains opt-in via `AGENT_PROVIDER`, unchanged from phase 1.
- Any external infra. The cron registry, event dispatch, and queue all stay in-process, per `CLAUDE.md`.
