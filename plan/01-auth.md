# Plan: Auth

**Spec:** [`spec/01-auth.md`](../spec/01-auth.md)
**Depends on:** `00-project-setup`

## Backend Tasks

- [ ] `models/User.js` — Mongoose schema (`email` unique+lowercase, `passwordHash`, `createdAt`)
- [ ] `utils/password.js` — `hashPassword(plain)`, `comparePassword(plain, hash)` via `bcrypt`
- [ ] `utils/jwt.js` — `signToken(userId)`, `verifyToken(token)` via `jsonwebtoken` + `JWT_SECRET`
- [ ] `middleware/requireAuth.js` — reads `Authorization: Bearer <token>`, verifies, attaches `req.userId`, else `401`
- [ ] `controllers/authController.js` — `register`, `login`, `me`
- [ ] `routes/auth.js` — `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` (behind `requireAuth`)
- [ ] Mount `auth` routes in `app.js`
- [ ] Validation: email format + non-empty password on register/login (basic, no library needed — simple regex/length checks)
- [ ] Duplicate email on register → `409`
- [ ] Wrong email/password on login → `401` with a generic "invalid credentials" message

## Frontend Tasks

- [ ] `store/authStore.js` (zustand) — holds `{ token, user }`, persists to `localStorage`, exposes `login()`, `logout()`
- [ ] `api/auth.js` — `register(email, password)`, `login(email, password)`, `me()`
- [ ] Axios request interceptor (in `api/client.js`) — attaches `Authorization: Bearer <token>` from `authStore`
- [ ] Axios response interceptor — on `401`, clear `authStore` and redirect to `/login`
- [ ] `pages/Register.jsx` — form, calls `register`, on success stores token and navigates to `/dashboard`
- [ ] `pages/Login.jsx` — form, calls `login`, same success behavior
- [ ] Inline error display on both forms (409/401 messages from the API)
- [ ] `components/ProtectedRoute.jsx` — wraps routes, redirects to `/login` if no token in `authStore`
- [ ] Wrap `/dashboard`, `/workflows/:id`, `/runs/:id` etc. with `ProtectedRoute`
- [ ] Logout button in the top nav — calls `authStore.logout()`, redirects to `/login`

## Verification

- [ ] Register a new account → redirected to Dashboard, logged in
- [ ] Log out, log back in with same credentials → succeeds
- [ ] Visit a protected route while logged out → redirected to `/login`
- [ ] Register with an already-used email → sees a clear 409 error, no crash
- [ ] Log in with wrong password → sees a generic invalid-credentials error
