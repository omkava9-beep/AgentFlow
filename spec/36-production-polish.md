# Spec: Production Polish

**Status:** Phase 3 — Tier 3
**Milestone:** M4
**Depends on:** every Tier 1 spec (`22`–`28`, `30`, `37`). Parts of the demo seed depend on Tier 2 (`29`, `31`–`33`, `35`) and degrade gracefully if those aren't built.
**Revises:** `15-workflow-templates.md` (template edit and delete), `01-auth.md` (profile, password change, session invalidation), `09`/`24` (a status view over queue, cache, cron and sockets)

## Summary

The last 10% that makes the product feel finished rather than demoed:

- a **⌘K command palette** and an **onboarding checklist**,
- a one-command **demo seed** that builds the whole presentation scenario,
- **profile settings** and **template management** (closing report §13.3),
- consistent **loading, empty, error and toast** patterns across every page,
- a **status page** that shows the in-process machinery without leaking across tenants,
- **CI** that finally runs the check suites automatically (report §14.1, "the cheapest remaining improvement by a wide margin"), and
- a real **README**.

Nothing here adds a new engine capability. It's all surface, verification and first-run experience. That's exactly why it comes last and gets cut first (`PHASE_3_SCOPE.md`).

## Goals

### 1. Command palette (⌘K / Ctrl+K)

- It opens from anywhere in the signed-in app. While it's open it takes keyboard focus, so the Builder's canvas shortcuts (`useCanvasShortcuts`: ⌘Z/⌘C/⌘V/⌘D/Delete) don't fire underneath it.
- Command groups:
  - **Navigate:** Dashboard, Templates, Analytics, Notifications, Outbox, and each Settings tab.
  - **Create:** New workflow, New from template…, Invite people.
  - **Switch workspace:** one entry per membership.
  - **Jump to:** workflows by name and recent runs.
  - **Preferences:** toggle theme.
- **Every command is permission-aware** through `useCan` (`23`). A viewer never sees "New workflow". Commands they can't use are omitted, not disabled.
- "Jump to" searches through a new `GET /api/search?q=` endpoint, scoped to the workspace, with results debounced by 150 ms. It returns up to 8 workflows (case-insensitive name match) and 5 runs (id prefix, or matching workflow name). The navigation and create groups are matched on the client with a simple subsequence fuzzy match.
- The last 5 commands you used are remembered in `localStorage` (inside try/catch) and shown first when the query is empty.

### 2. Onboarding checklist

- Shown on the Dashboard of a workspace until it's completed or dismissed, as a card with 6 steps: *Create a workflow · Run it · Invite a teammate · Add a connection · Publish a version · Set up a trigger*.
- **The state is derived from existing data, not tracked separately.** `GET /api/workspaces/:id/onboarding` answers each step with an `exists` query (for example, "any Run in this workspace", or "any Membership besides mine or any pending Invitation"). No counters can drift out of step with reality.
- Dismissing sets `Membership.onboardingDismissedAt`, so it's per person: Bob dismissing it doesn't hide it for Alice.
- Each step links to the place where it gets done. Steps the viewer's role can't perform are shown as "ask an admin".

### 3. Demo seed: `npm run seed:demo`

`server/src/scripts/seedDemo.js` builds the `PHASE_3_SCOPE.md` demo script in one command:

- **Users:** `alice@acme.test`, `bob@acme.test` and `carol@globex.test`. They all use the password `demo-password`, printed at the end. `.test` is a reserved TLD, so these can never be real addresses.
- **Workspaces:**
  - **Acme** (`team` plan): Alice is owner, Bob is editor, and a pending invite for `dana@acme.test` sits in the Outbox.
  - **Globex** (`free` plan): Carol is owner.
- **Connections** (sandbox mode, so the demo works offline): Stripe, Slack, GitHub and the bundled MCP demo server (`37`). The Slack connection's description says "paste a real incoming-webhook URL and switch to live for the demo".
- **Workflows:**
  - Acme's **Payment triage** (Stripe *Payment failed* → Agent with MCP `lookup_customer` + HTTP Request tools → Condition → Approval → Slack + GitHub issue), published as **v1–v3** with meaningful differences, so the version diff (`30`) has something to show.
  - Two more Acme workflows cloned from built-in templates.
  - Globex's **Bulk enrich**, a 30-item loop (`31`), for demonstrating the fair queue (`33`).
- **History:** 14 days of backfilled runs per workspace (inserted directly as `Run` documents, with a realistic mix of triggers, statuses and durations and ~8% failures), matching `UsageCounter` rows, one comment thread with an `@alice` mention (`29`), and a workspace API key whose plaintext is printed once.
- **Safety:** the seed only ever deletes documents belonging to its own demo users and workspaces (marked `Workspace.demo: true`, with `.test` emails), so it's re-runnable and never touches real data. It refuses to run if `INTEGRATIONS_LIVE=true` **and** any seeded connection is set to live mode, because a seed shouldn't post to real services.
- **Graceful degradation:** each section is guarded. If `31`, `32` or `33` isn't built yet, the seed skips the loop workflow, the Approval node or the plan settings, and says so in its output.

### 4. Profile settings

Settings gains a **Profile** tab, which belongs to the user and applies across all their workspaces:

- Edit your display name (used by presence `28` and mentions `29`). Email is shown but read-only; changing it is out of scope.
- **Change password:** current password plus a new one, following `01`'s length rule.
- **Password change signs out other sessions.** `User.tokenVersion` is embedded in the JWT and checked by `requireAuth` and by `24`'s socket handshake. A password change increments it, so every other token is rejected on its next request. That also gives the user a "Sign out everywhere" button for free. It costs one user read per request, which is negligible at this scale, since `22` already reads the membership on every request.

### 5. Template management (closes report §13.3)

- `PATCH /api/templates/:id` `{ name, description }` and `DELETE /api/templates/:id`, for **this workspace's templates only**, gated by `templates:create`. Built-in templates (`workspaceId: null`) are immutable, and attempts return 403.
- A template's `createdBy` is shown ("by Bob · 3 days ago").
- Deleting a template never affects workflows already created from it. They were copies (`15`).
- The gallery card gets an overflow menu with Rename / Edit description / Delete (with confirmation).

### 6. Consistent UI states

These patterns replace today's per-page variety ("Loading..." text, inline `ErrorText`, `window.confirm`):

| Pattern | Component | Used for |
|---|---|---|
| Skeletons | `Skeleton`, `SkeletonCard`, `SkeletonTable` | Every list or table page while it's loading (Dashboard, Templates, run history, Analytics, every Settings tab) |
| Empty state | `EmptyState { icon, title, body, action }` | Every list with zero items, each with a helpful primary action |
| Toasts | `toastStore` + `<Toaster />`, `toast.success / error / info` | Transient outcomes: saved, invited, copied, a failure that isn't tied to a form field. Also the toasts referenced by `22`, `23` and `29`. |
| Inline errors | the existing `ErrorText` | Form-field validation only |
| Confirm dialog | `ConfirmDialog` (a promise-based `confirm()`) | Replaces `window.confirm` (for example, Dashboard's delete). A destructive action can require typing a name, reused by `22`'s workspace delete. |
| Error boundaries | `RouteErrorBoundary`, `CanvasErrorBoundary` | A crashing page shows "Something went wrong" with Reload and, in dev, the stack. A crashing canvas node config doesn't blank the whole Builder. |

- The catch-all `*` route currently **redirects to the dashboard**. It becomes a real **404 page** ("This page doesn't exist" plus a link home). A silent redirect hides broken links.
- Each route sets `document.title` (for example, `Payment triage · Acme — AgentFlow`).
- `?` opens a keyboard-shortcut help sheet listing the canvas shortcuts and ⌘K.

### 7. Status page

**The decision: workspace-scoped for members, plus an optional operator view configured by env.**

The in-process machinery (queue, cache, cron registry, sockets) is shared by every tenant, so a single global status page would show one tenant how busy the others are. That's the kind of leak `24` exists to prevent.

- **`/w/:slug/status`** (every member) shows only this workspace's slice:
  - API and MongoDB health;
  - integration mode (`INTEGRATIONS_LIVE`, `AGENT_PROVIDER`: names only, never keys);
  - queue (this workspace's `active` / `queued` / `cap`, and `poolSaturated` from `33`);
  - cache (this workspace's entry count and hit rate; countable because keys are prefixed with `workspaceId` per `22`);
  - cron (this workspace's registered schedules with their next fire time, from `12`'s registry filtered by workflow);
  - realtime (connected sockets and online members, from `28`'s presence);
  - MCP (the state of each MCP connection's pooled client: connected, idle or error, from `37`).
- **Operator view:** users whose email is listed in `OPERATOR_EMAILS` (read once in `config/env.js`, empty by default) see a **Global** toggle with pool-wide totals and a per-workspace breakdown of the queue. That makes demo step 7 ("the fair queue keeping Acme's loop from starving Globex") visible. It's an operator setting, not a workspace role, because it spans tenants. It's documented as a local-deployment convenience.
- The page refreshes every 5 s over REST (`GET /api/workspaces/:id/status`, `GET /api/status/global` for operators). The queue section also updates live from `queue:stats`.

### 8. CI (closes report §14.1)

`.github/workflows/checks.yml` runs on every push and pull request:

- **server job:**
  1. `services: mongo:7` container, with `node-version: 22`.
  2. `npm ci`.
  3. `npm run check:all`, a new orchestrator script (`server/src/scripts/checkAll.mjs`). It starts the app in-process on a free port against a throwaway database, runs every server suite (`check:engine`, `triggers`, `templates`, `analytics`, `share`, `tenancy`, `collab`, `versions`, `integrations`, `http`, `mcp`, `queue`, `audit`) with `BASE` set, drops the database, and exits non-zero if any suite failed.
  - This replaces the "start a server on port 45xx in another terminal" instructions each phase-2 suite needs, and it's the same command developers run locally.
- **client job:** `npm ci`, `npm run lint`, `npm run check:logic` and `npm run build`.
- **CI is developer tooling on GitHub's infrastructure, not part of AgentFlow's runtime.** The app still runs with `npm run dev` and a MongoDB string, so this doesn't conflict with `CLAUDE.md`'s no-external-infra rule.
- Checks that need secrets never run in CI. `check:integrations` forces `INTEGRATIONS_LIVE=false`, and `check:http` runs against a local test server with the dev private-network flag. The browser-driven UI checks stay outside CI, as in phase 2, because they need two running servers and a browser.

### 9. README

A root **`README.md`** (there isn't one today) with:

- what AgentFlow is, in two sentences, plus screenshots;
- a quick start (MongoDB, `cp .env.example .env`, `npm install`, `npm run dev` ×2, `npm run seed:demo`);
- the demo accounts;
- an environment-variable table covering every variable in both `.env.example` files, marking which are required, which are secret, and their defaults;
- the check commands and CI badge;
- an architecture sketch, with links to `PRODUCT.md`, `PHASE_3_SCOPE.md` and `spec/README.md`.

Both `.env.example` files are brought up to date with every phase-3 variable, and their comments are kept in sync with the README table.

## Non-goals

- A marketing site, public docs site or changelog page.
- Full-text search over node configs or run outputs. Search covers names and ids only.
- Internationalisation, accessibility audit tooling, or visual regression tests (basic keyboard reachability for the palette and dialogs is in scope).
- Changing email addresses, account deletion, and avatars beyond generated initials.
- Deploying anywhere. CI verifies and doesn't deploy.

## Data Model

- **User:** add `tokenVersion: number` (default 0).
- **Membership:** add `onboardingDismissedAt: Date | null`.
- **Workspace:** add `demo: boolean` (default false; only set by the seed).
- **Template:** no schema change. Edit and delete are new routes only.

## API

| Method | Path | Permission | Response |
|---|---|---|---|
| GET | `/api/search` | `workflow:read` | `?q=` → `{ workflows: [{ id, name }], runs: [{ id, workflowName, status, createdAt }] }` |
| GET | `/api/workspaces/:id/onboarding` | `workflow:read` | `{ steps: [{ key, done }], dismissed }` |
| POST | `/api/workspaces/:id/onboarding/dismiss` | member | `204` |
| PATCH | `/api/auth/me` | JWT | `{ name }` → user |
| POST | `/api/auth/password` | JWT | `{ currentPassword, newPassword }` → `{ token }` (a fresh token for this session) |
| POST | `/api/auth/sessions/revoke` | JWT | → `{ token }` ("sign out everywhere else") |
| PATCH | `/api/templates/:id` | `templates:create` | `{ name?, description? }` → template. `403` for built-ins. |
| DELETE | `/api/templates/:id` | `templates:create` | `204`. `403` for built-ins. |
| GET | `/api/workspaces/:id/status` | `workflow:read` | the workspace-scoped status sections |
| GET | `/api/status/global` | operator only | pool-wide totals and per-workspace queue breakdown. `404` for non-operators. |

`404` rather than `403` for non-operators on `/api/status/global`, so the route doesn't advertise itself.

## UI Behavior

Covered in the Goals above. In summary: the palette overlay, the onboarding card on the Dashboard, the Profile tab, template overflow menus, the skeleton/empty/toast/confirm/error-boundary patterns on every page, the 404 page, the shortcut sheet, and `/w/:slug/status` with a "Status" link in the user menu.

## Edge Cases & Error Handling

- **⌘K inside a text field or the code editor (`31`)** → the palette still opens. ⌘K isn't a text-editing shortcut, so taking it is safe. Plain `?` only opens the shortcut sheet when focus is outside any input.
- **A search racing workspace switches** → responses are tagged with the workspace id they were requested for, and ignored if it's no longer current.
- **Password change with the wrong current password** → 400, with the same generic phrasing as login. Other sessions are revoked only on success.
- **Token issued before `tokenVersion` existed** → treated as version 0, so phase-2 tokens keep working until the first password change.
- **Seed run twice** → the second run removes and recreates only the demo documents. Printed credentials are unchanged, and the API key is new (the old one is revoked).
- **Seed with `31`/`32`/`33` missing** → the missing sections are skipped with a notice. The rest of the demo still works.
- **Deleting a template another member is currently viewing in the gallery** → their "Use" button returns 404, and the gallery refetches with a toast.
- **`check:all` with a suite hanging** → a per-suite timeout (5 min) fails that suite with a clear message instead of stalling CI until GitHub's job limit.
- **Operator view with an empty `OPERATOR_EMAILS`** → the toggle is never shown, and the route returns 404.

## Acceptance Criteria

- [ ] ⌘K opens from every signed-in page. Each command group works. A viewer's palette has no create commands. Canvas shortcuts don't fire while it's open.
- [ ] "Jump to" finds workflows and runs in the current workspace only.
- [ ] The onboarding checklist reflects real data (creating a workflow ticks step 1 with no explicit tracking), and dismissal is per member.
- [ ] `npm run seed:demo` on an empty database produces the full demo-script scenario, prints credentials and an API key, can be re-run safely, and never modifies non-demo documents.
- [ ] Changing a password returns a new token for this session and rejects every other session's token on its next REST call and socket connect.
- [ ] Workspace templates can be renamed and deleted. Built-ins can't (403). Workflows created from a deleted template are unaffected.
- [ ] No page shows bare "Loading..." text or uses `window.confirm`. Every empty list renders an `EmptyState`. An unknown URL renders the 404 page.
- [ ] A component that throws inside a node config panel shows the canvas error boundary, and the rest of the Builder keeps working.
- [ ] `/w/:slug/status` shows only the current workspace's queue, cache, cron and socket numbers. `/api/status/global` returns 404 for non-operators.
- [ ] The CI workflow runs `check:all` against a MongoDB service container plus the client lint, logic and build steps, and fails the build when any suite fails.
- [ ] `README.md` lets a new developer go from clone to a seeded demo with only the steps it lists. Every env var in both `.env.example` files appears in its table.

`npm run check:all` runs every server suite. The UI criteria are verified by driving the real app in a browser, as in phase 2.
