# Spec: Basic RBAC & Sharing

**Status:** Stretch
**Milestone:** M3
**Depends on:** `01-auth.md`, `04-workflow-persistence.md`

## Summary

A minimal access-control extension: workflows are still single-owner (no real multi-tenant teams), but an owner can generate a read-only share link so someone else can view a workflow's design and run history without logging in as the owner.

## Goals

- Owner-only editing is already implicit in `04` (ownership check on write routes) — this spec formalizes it and adds the one new capability: a **read-only share link**.
- A shareable link (`/shared/:shareToken`) renders the workflow's canvas (view-only, no edit controls) and its run history, without requiring auth.

## Non-goals

- Real roles (admin/editor/viewer) or team/org membership — explicitly out of scope; "owner" vs. "anyone with the link, read-only" is the entire access model.
- Revocable, expiring, or password-protected share links beyond a simple regenerate-token action (mirrors `13-webhook-trigger.md`'s token pattern).

## Data Model

Add to **Workflow**:
```
shareToken: string | null   // null = not shared
```

## API

| Method | Path | Response |
|---|---|---|
| POST | `/api/workflows/:id/share` | `{ shareToken, url }` (generates/regenerates) |
| DELETE | `/api/workflows/:id/share` | `204` (disables sharing) |
| GET | `/api/shared/:shareToken` | read-only workflow + run history (no auth required) |

`GET /api/shared/:shareToken` is intentionally outside the auth middleware, same pattern as the webhook endpoint in `13`.

## UI Behavior

- Workflow Builder has a "Share" action generating/copying the read-only URL, with a toggle to disable sharing (invalidates the token).
- `/shared/:shareToken` renders a stripped-down, non-editable version of the Builder canvas plus a read-only Run History list — no Node Configuration Panel, no Save/Run buttons.

## Edge Cases & Error Handling

- Disabled/unknown share token → simple 404 page, don't distinguish "never existed" from "disabled."
- Regenerating the token invalidates any previously shared link immediately.

## Acceptance Criteria

- [ ] A generated share link opens the workflow read-only in an incognito/logged-out browser.
- [ ] Disabling sharing immediately breaks the old link (404).
- [ ] The shared view has no path to editing or running the workflow.
