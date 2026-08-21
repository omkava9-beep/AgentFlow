# Plan: Webhook Trigger

**Spec:** [`spec/13-webhook-trigger.md`](../spec/13-webhook-trigger.md)
**Depends on:** `10-manual-run-trigger`

> **Status: complete.** Verified by `npm run check:triggers` (14 checks: token generation,
> payload reaching the Start node and flowing into the graph, no-payload calls, regeneration
> invalidating the old URL, disabled and unknown tokens both 404ing identically, malformed JSON
> returning a clear 400) plus browser checks for the URL/Copy/Regenerate panel and an
> end-to-end fire from the copied URL.
>
> Added `PUT /api/workflows/:id/webhook` beyond the spec's table — the enable/disable toggle
> needs it, since regenerate alone can only turn a webhook on. Now in `spec/13`.

## Backend Tasks

- [x] Extend `models/Workflow.js` with `webhook: { token, enabled }`
- [x] Token generation helper (e.g. `crypto.randomBytes(24).toString('hex')`)
- [x] `POST /api/workflows/:id/webhook/regenerate` (authed) — generates/replaces token, returns `{ token, url }`
- [x] `POST /api/hooks/:token` — **outside** `requireAuth**: look up workflow by `webhook.token` + `enabled: true`; `404` if not found/disabled; otherwise call the shared `createAndStartRun(workflowId, req.body)` from `12`, passing the payload through as the Start node's input
- [x] Mount `/api/hooks` routes separately from the authed `/api/*` router group

## Frontend Tasks

- [x] "Trigger" panel in the Builder — shows the generated webhook URL (copy-to-clipboard), "Regenerate" action, enable/disable toggle
- [x] Confirmation before regenerating (invalidates the old URL — mildly destructive)

## Verification

- [x] `curl -X POST <webhook-url>` starts a run visible in Run History/Monitor
- [x] Regenerating the token immediately invalidates the old URL (`404` on next call)
- [x] Disabling the webhook makes the endpoint reject with `404`
- [x] A JSON payload sent with the webhook call is available as the Start node's input inside the run
