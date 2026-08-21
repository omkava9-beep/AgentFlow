# First Presentation — Demo Scope (2-week target)

> Historical record of what presentation 1 covered. The "Coming Soon" items below are
> being built out in phase 2 — see [`PHASE_2_SCOPE.md`](PHASE_2_SCOPE.md) for current status.

## Live / fully working for the demo

Everything in Milestones 1–2 — the full core loop: register/login → build a workflow on the canvas → configure nodes → save → run it → watch it execute live → review it in history.

- `01-auth`
- `02-workflow-builder-canvas`
- `03-node-configuration-panel`
- `04-workflow-persistence`
- `05-agent-tool-providers` (mock provider only — real LLM swap is mentioned as a "coming soon" capability, not demoed live unless there's time to spare)
- `06-execution-engine`
- `07-async-job-queue`
- `08-in-memory-cache`
- `09-realtime-monitoring`
- `10-manual-run-trigger`
- `11-execution-history`

## "Coming Soon" in the UI (Milestone 3, all stretch)

Visible as greyed-out nav items / disabled buttons with a "Coming Soon" badge — so the demo shows the full intended app shape, not just what's done:

- Scheduled Triggers (`12`)
- Webhook Trigger (`13`)
- Analytics (`14`) — nav item disabled
- Templates (`15`) — nav item disabled
- Agent Handoff (`16`) — mentioned as a node-type variant, disabled in the palette
- Failure Injection controls (`17`) — the failure-rate field in Node Config Panel shows as disabled/"coming soon" rather than being removed
- Share links (`18`)

## Implementation note

A `COMING_SOON_FEATURES` constant (frontend) drives which nav items/buttons render disabled with a badge, so flipping a feature "live" later is a one-line change, not a UI rewrite. See `plan/00-project-setup.md` and onward for build order.
