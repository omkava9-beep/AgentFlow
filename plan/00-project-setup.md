# Plan: Project Setup

**Precedes:** every spec — do this first.

## Backend Setup (`server/`)

- [ ] `npm init` in `server/`; install `express`, `mongoose`, `dotenv`, `cors`, `jsonwebtoken`, `bcrypt`, `socket.io`, `node-cron`
- [ ] Install dev deps: `nodemon`
- [ ] Create folder structure:
  ```
  server/src/
    config/       # db.js, agentProvider.js, env.js
    models/       # User, Workflow, Run, Template
    routes/
    controllers/
    middleware/   # requireAuth, errorHandler
    engine/       # execution engine (06)
    queue/        # in-process job queue (07)
    cache/        # TTL cache (08)
    providers/    # AgentProvider implementations (05)
    tools/        # ToolRegistry + mock tool handlers (05)
    sockets/      # Socket.io event wiring (09)
  ```
- [ ] `server/.env.example` with: `PORT`, `MONGODB_URI`, `JWT_SECRET`, `AGENT_PROVIDER=mock`, `ANTHROPIC_API_KEY=`
- [ ] `config/db.js` — Mongoose connection, fail fast with a clear error if `MONGODB_URI` is unreachable
- [ ] `config/env.js` — loads/validates required env vars once at startup (fail fast on missing `JWT_SECRET`, or missing `ANTHROPIC_API_KEY` when `AGENT_PROVIDER=anthropic`)
- [ ] Base Express app (`app.js`): `cors`, `express.json()`, centralized error-handling middleware, `GET /api/health` route
- [ ] Server entrypoint (`index.js`): creates HTTP server, attaches Socket.io, connects to Mongo, starts listening
- [ ] `package.json` scripts: `dev` (nodemon), `start`
- [ ] Register cron/scheduled-job bootstrap hook placeholder (actual logic added in `12-scheduled-triggers`)

## Frontend Setup (`client/`)

- [ ] Scaffold with Vite (`npm create vite@latest client -- --template react`)
- [ ] Install: `reactflow`, `react-router-dom`, `zustand`, `socket.io-client`, `axios`, `tailwindcss` (+ `postcss`, `autoprefixer`), `recharts` (used later by `14`)
- [ ] Configure Tailwind (`tailwind.config.js`, `index.css` directives)
- [ ] Create folder structure:
  ```
  client/src/
    pages/        # Login, Register, Dashboard, Builder, RunMonitor, RunHistory, Analytics
    components/   # shared UI (NodePalette, NodeConfigPanel, StatusBadge, ...)
    store/        # zustand stores (auth, workflow, run)
    api/          # axios instance + per-resource API modules
    hooks/
  ```
- [ ] `client/.env.example` with `VITE_API_URL`, `VITE_SOCKET_URL`
- [ ] `api/client.js` — axios instance with `baseURL` from `VITE_API_URL`; request interceptor attaches `Authorization` header from auth store
- [ ] Set up React Router with placeholder routes: `/login`, `/register`, `/dashboard`, `/workflows/:id`, `/runs/:id`
- [ ] Base `App` layout: top nav (logo, nav links, logout), `<Outlet />`
- [ ] `package.json` scripts: `dev`, `build`, `preview`

## Integration / Verification

- [ ] `npm run dev` in both `server/` and `client/` simultaneously; confirm no port conflicts (e.g. server on `3000`, client on `5173`)
- [ ] Frontend successfully calls `GET /api/health` and renders the result (throwaway check, can be removed once `01-auth` lands)
- [ ] CORS configured so the Vite dev server origin is allowed by the Express `cors()` config
- [ ] Confirm MongoDB connects locally (or via a free Atlas cluster) using `MONGODB_URI`
