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

> **Phase 2 is complete.** All nine steps are done and every "Coming Soon" badge is gone —
> `comingSoon.js` and `ComingSoonBadge.jsx` have been deleted rather than left as an
> all-`false` config.

## Progress

| Step | Spec | Status |
|---|---|---|
| 1 | `19-engine-parallelism-and-control` | **Done** — `npm run check:engine` (now 44 checks incl. `16`) |
| 2 | `17-failure-injection` | **Done** — verified over HTTP + cache-free handler check |
| 3 | `20-builder-ux` | **Done** — store/validator checks (now in `check:logic`) + 16 browser checks |
| 4 | `16-agent-handoff` | **Done** — 6 engine + 18 store + 14 browser checks |
| 5 | `12` / `13` / event trigger | **Done** — 28 API + 20 browser + 11 cron checks |
| 6 | `21-extended-tool-catalog` | **Done** — 32 handler + 15 browser + 8 validator checks |
| 7 | `15-workflow-templates` | **Done** — 27 API + 17 browser checks |
| 8 | `14-analytics-dashboard` | **Done** — 29 API + 15 browser checks + screenshot review |
| 9 | `18-rbac` | **Done** — 27 API + 22 browser checks |

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

## Check scripts

Phase 2's acceptance criteria are runnable rather than prose:

| Command | Covers |
|---|---|
| `cd server && npm run check:engine` | spec `19`, `16`, `17` — 44 checks against a throwaway database |
| `cd server && npm run check:triggers` | spec `12`, `13`, `21`'s event dispatch — 28 checks against a running server |
| `cd server && npm run check:templates` | spec `15` — 27 checks against a running server (needs `seed:templates` first) |
| `cd server && npm run check:analytics` | spec `14` — 29 checks; needs a running server on the same `MONGODB_URI` |
| `cd server && npm run check:share` | spec `18` — 27 checks against a running server |
| `cd client && npm run check:logic` | store, graph validator, cron helper — 86 checks, no browser needed |

UI behavior is verified by driving the real app in headless Chrome; those scripts live outside the repo since they need two servers running.

## Retiring the Coming Soon scaffolding — done

`client/src/comingSoon.js` and `client/src/comingSoonCatalog.js` were built so flipping a feature live was a one-line change. As of the end of phase 2:

- `comingSoon.js` and `ComingSoonBadge.jsx` are **deleted**. Every flag reached `false`, and a dead all-`false` config is worse than no config.
- `ACTION_TYPES` is **gone** from `comingSoonCatalog.js`; the tool list comes from `GET /api/tools`, so the server-side `ToolRegistry` is the single source of truth (see `21`).
- `TRIGGER_TYPES` **stays** as a static catalog with every entry `live: true` — triggers are a fixed, small set the server doesn't enumerate.

## Non-goals for phase 2

- Multi-user / team features beyond `18`'s single read-only share link.
- Real outbound network calls from tool nodes — the new `http-request` tool stays mocked on purpose (see `21`).
- Real LLM calls as the default. `LLMAgentProvider` remains opt-in via `AGENT_PROVIDER`, unchanged from phase 1.
- Any external infra. The cron registry, event dispatch, and queue all stay in-process, per `CLAUDE.md`.
