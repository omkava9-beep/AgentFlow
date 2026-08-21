# Plan: Basic RBAC & Sharing

**Spec:** [`spec/18-rbac.md`](../spec/18-rbac.md)
**Depends on:** `01-auth`, `04-workflow-persistence`

## Backend Tasks

- [ ] Extend `models/Workflow.js` with `shareToken: string | null`
- [ ] Token generation helper (reuse the same pattern as `13-webhook-trigger`'s token, or a shared `utils/token.js`)
- [ ] `POST /api/workflows/:id/share` (authed) — generates/regenerates `shareToken`, returns `{ shareToken, url }`
- [ ] `DELETE /api/workflows/:id/share` (authed) — clears `shareToken`
- [ ] `GET /api/shared/:shareToken` — **outside** `requireAuth`: look up workflow by token, return read-only workflow + run history payload; `404` if not found/null token

## Frontend Tasks

- [ ] Builder: "Share" action — generate/copy the read-only URL, toggle to disable sharing, confirmation before regenerating (invalidates old link)
- [ ] `pages/SharedWorkflowView.jsx` at `/shared/:shareToken` — stripped-down, non-editable canvas rendering + read-only run history list; no Node Config Panel, no Save/Run buttons, no auth required to view

## Verification

- [ ] A generated share link opens the workflow read-only in an incognito/logged-out browser
- [ ] Disabling sharing immediately breaks the old link (`404`)
- [ ] Regenerating invalidates the previous link
- [ ] The shared view has no path to editing or running the workflow
