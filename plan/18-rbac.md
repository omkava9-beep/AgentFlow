# Plan: Basic RBAC & Sharing

**Spec:** [`spec/18-rbac.md`](../spec/18-rbac.md)
**Depends on:** `01-auth`, `04-workflow-persistence`

> **Status: complete.** Verified by `npm run check:share` (27 checks, most of them about
> what the payload must NOT contain) plus 22 browser checks driving the link as a logged-out
> visitor.
>
> Three things worth recording, now in `spec/18`:
> - The payload is a **whitelist**. Returning the workflow document with a few fields deleted
>   would have leaked `webhook.token` — a capability to start runs, which turns a view link
>   into an execute link.
> - Share URLs come from `CLIENT_ORIGIN`, not `PUBLIC_BASE_URL`. The first version pointed at
>   the API origin (`:4000`), which serves no `/shared` page.
> - The page uses a bare axios call, not `apiClient`: that instance logs the user out and
>   redirects to `/login` on a 401, which would bounce the very visitor the link is for.
>
> Also removed `comingSoon.js` and `ComingSoonBadge.jsx` — with `shareLinks` live, all six
> flags were false and the module was dead weight.

## Backend Tasks

- [x] Extend `models/Workflow.js` with `shareToken: string | null`
- [x] Token generation helper (reuse the same pattern as `13-webhook-trigger`'s token, or a shared `utils/token.js`)
- [x] `POST /api/workflows/:id/share` (authed) — generates/regenerates `shareToken`, returns `{ shareToken, url }`
- [x] `DELETE /api/workflows/:id/share` (authed) — clears `shareToken`
- [x] `GET /api/shared/:shareToken` — **outside** `requireAuth`: look up workflow by token, return read-only workflow + run history payload; `404` if not found/null token

## Frontend Tasks

- [x] Builder: "Share" action — generate/copy the read-only URL, toggle to disable sharing, confirmation before regenerating (invalidates old link)
- [x] `pages/SharedWorkflowView.jsx` at `/shared/:shareToken` — stripped-down, non-editable canvas rendering + read-only run history list; no Node Config Panel, no Save/Run buttons, no auth required to view

## Verification

- [x] A generated share link opens the workflow read-only in an incognito/logged-out browser
- [x] Disabling sharing immediately breaks the old link (`404`)
- [x] Regenerating invalidates the previous link
- [x] The shared view has no path to editing or running the workflow
