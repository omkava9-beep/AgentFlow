# Spec: Auth

**Status:** MVP
**Milestone:** M1
**Depends on:** —

> **Revised in phase 3:** ownership moved from users to workspaces — see [`22`](22-workspaces-multitenancy.md) (workspaces, `X-Workspace-Id`, migration) and [`23`](23-roles-and-invitations.md) (roles). The "multi-tenant orgs/teams" non-goal below no longer applies. Profile editing, password change and sign-out-everywhere (`tokenVersion`) are added in [`36`](36-production-polish.md).

## Summary

JWT-based authentication so workflows and runs can be scoped to a single owning user. No social login, no email verification, no password reset flow — just enough auth to make "your workflows" a meaningful concept.

## Goals

- Register with email + password.
- Log in and receive a JWT.
- Every workflow/run/template is owned by exactly one user; all API routes (except register/login) require a valid token.

## Non-goals

- OAuth / social login.
- Email verification, password reset, 2FA.
- Multi-tenant orgs/teams (see `18-rbac.md` for the only stretch multi-user concept — a read-only share link, not real multi-tenancy).

## Data Model

**User**
```
{
  _id,
  email: string (unique, lowercase),
  passwordHash: string,
  createdAt: Date
}
```

## API

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/auth/register` | `{ email, password }` | `{ token, user: { id, email } }` |
| POST | `/api/auth/login` | `{ email, password }` | `{ token, user: { id, email } }` |
| GET | `/api/auth/me` | — (Bearer token) | `{ id, email }` |

- Passwords hashed with `bcrypt` before storage.
- JWT signed with a server-side secret (`JWT_SECRET` env var), reasonable expiry (e.g. 7 days), sent as `Authorization: Bearer <token>`.
- An Express middleware (`requireAuth`) validates the token and attaches `req.userId` to the request; all workflow/run/template routes use it.

## UI Behavior

- `/login` and `/register` pages, simple email/password forms.
- On success, store the token (e.g. `localStorage`) and redirect to the Dashboard.
- Unauthenticated access to any other route redirects to `/login`.
- A logout action clears the stored token and redirects to `/login`.

## Edge Cases & Error Handling

- Duplicate email on register → 409 with a clear message.
- Wrong password / unknown email on login → 401 with a generic "invalid credentials" message (don't reveal which field was wrong).
- Missing/expired/invalid token on a protected route → 401, frontend redirects to `/login`.

## Acceptance Criteria

- [ ] Can register a new account and land on the Dashboard logged in.
- [ ] Can log out and log back in with the same credentials.
- [ ] Visiting any protected route while logged out redirects to `/login`.
- [ ] A workflow created by user A is never visible/editable by user B.
