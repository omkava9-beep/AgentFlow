# Plan: Analytics Dashboard

**Spec:** [`spec/14-analytics-dashboard.md`](../spec/14-analytics-dashboard.md)
**Depends on:** `11-execution-history`

## Backend Tasks

- [ ] `controllers/analyticsController.js` — `getSummary(userId, dateRange)`
- [ ] MongoDB aggregation pipeline(s) over `Run` (scoped to `ownerId`, filtered by date range):
  - [ ] `totalRuns`, `successRate` (success / total)
  - [ ] `avgDurationMs` (`finishedAt - startedAt` average)
  - [ ] `runsByDay` — group by day for the runs-over-time chart
  - [ ] `topNodeTypes` — unwind `nodeResults`/join against workflow node types, group + count
- [ ] `GET /api/analytics/summary?range=7|30|90` route, behind `requireAuth`

## Frontend Tasks

- [ ] `pages/Analytics.jsx` — new nav item/route
- [ ] Stat tiles: total runs, success rate, avg duration
- [ ] Runs-over-time chart (Recharts line/area) from `runsByDay`
- [ ] Top node types chart (Recharts bar) from `topNodeTypes`
- [ ] Date-range dropdown (7/30/90 days) re-querying `GET /api/analytics/summary`
- [ ] Empty state for zero-runs users ("Run a workflow to see analytics here")

## Verification

- [ ] Numbers on the dashboard match a manual spot-check against Run History for the same user/date range
- [ ] Changing the date range updates all tiles/charts consistently
- [ ] A brand-new user with zero runs sees the empty state, not broken charts/errors
