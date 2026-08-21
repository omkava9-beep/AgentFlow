# Plan: Webhook Trigger

**Spec:** [`spec/13-webhook-trigger.md`](../spec/13-webhook-trigger.md)
**Depends on:** `10-manual-run-trigger`

## Backend Tasks

- [ ] Extend `models/Workflow.js` with `webhook: { token, enabled }`
- [ ] Token generation helper (e.g. `crypto.randomBytes(24).toString('hex')`)
- [ ] `POST /api/workflows/:id/webhook/regenerate` (authed) — generates/replaces token, returns `{ token, url }`
- [ ] `POST /api/hooks/:token` — **outside** `requireAuth**: look up workflow by `webhook.token` + `enabled: true`; `404` if not found/disabled; otherwise call the shared `createAndStartRun(workflowId, req.body)` from `12`, passing the payload through as the Start node's input
- [ ] Mount `/api/hooks` routes separately from the authed `/api/*` router group

## Frontend Tasks

- [ ] "Trigger" panel in the Builder — shows the generated webhook URL (copy-to-clipboard), "Regenerate" action, enable/disable toggle
- [ ] Confirmation before regenerating (invalidates the old URL — mildly destructive)

## Verification

- [ ] `curl -X POST <webhook-url>` starts a run visible in Run History/Monitor
- [ ] Regenerating the token immediately invalidates the old URL (`404` on next call)
- [ ] Disabling the webhook makes the endpoint reject with `404`
- [ ] A JSON payload sent with the webhook call is available as the Start node's input inside the run
