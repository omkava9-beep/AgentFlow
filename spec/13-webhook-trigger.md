# Spec: Webhook Trigger

**Status:** Stretch
**Milestone:** M3
**Depends on:** `10-manual-run-trigger.md`

> **Revised in phase 3:** Webhook runs always execute the published version (`409` if none) — see [`30`](30-workflow-versioning.md). Provider-shaped integration webhooks are separate — see [`27`](27-integration-catalog.md).

## Summary

An HTTP endpoint external systems (or a `curl`/Postman demo) can hit to start a workflow run — the "event-driven trigger" pillar of the product brief.

## Goals

- Each workflow can generate a unique webhook token/URL.
- `POST` to that URL creates a `Run` the same way `10` does, optionally passing a JSON payload through as the Start node's input.
- The endpoint requires the token (in the URL path or a header) instead of full user auth, since external callers won't have a JWT.

## Non-goals

- Signature verification / HMAC payload signing (a reasonable production feature, but adds complexity not needed to demonstrate the concept here).
- Retry/dead-letter handling for failed webhook deliveries — this project is the receiver, not the sender.

## Data Model

Add to **Workflow**:
```
webhook: { token: string, enabled: boolean } | null
```

## API

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/workflows/:id/webhook/regenerate` | — (authed) | `{ token, url }` |
| PUT | `/api/workflows/:id/webhook` | `{ enabled }` | updated webhook |
| POST | `/api/hooks/:token` | optional JSON payload | `202 { runId }` |

The `PUT` isn't in this spec's original table but the UI's enable/disable toggle needs it — regenerate alone can only ever turn a webhook *on*. Regenerating also enables, since handing back a fresh URL that then has to be switched on separately is a pointless extra step.

`/api/hooks/:token` is intentionally outside normal auth middleware — it looks up the workflow by token instead of by `req.userId`.

## UI Behavior

- Workflow Builder "Trigger" panel shows the generated webhook URL (copyable) with a "regenerate" action (invalidates the old token) and an enable/disable toggle.

## Edge Cases & Error Handling

- Unknown/disabled token → 404, don't reveal whether the token ever existed vs. was disabled.
- Malformed JSON payload → 400 with a clear message; the Start node just receives `null`/empty input if no payload is sent (payload is optional).

## Acceptance Criteria

- [ ] A `curl -X POST` to a workflow's webhook URL starts a run visible in Run History/Monitor.
- [ ] Regenerating the token invalidates the old URL immediately.
- [ ] Disabling the webhook causes the endpoint to reject new runs with 404.
