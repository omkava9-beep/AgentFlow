# Spec: Analytics Dashboard

**Status:** Stretch
**Milestone:** M3
**Depends on:** `11-execution-history.md`

## Summary

A charts page summarizing run history across the user's workflows — success/failure rates, durations, node usage, and volume over time — using Recharts on data aggregated from the `Run` collection.

## Goals

- Success vs. failure rate (overall, and optionally per workflow).
- Average/median run duration.
- Most-used node/tool types across all workflows (bar chart).
- Runs-over-time (line/area chart, e.g. runs per day over the last 30 days).

## Non-goals

- Real-time-updating charts (a manual refresh or periodic poll is fine — this isn't meant to reuse the Socket.io live-monitoring path).
- Cross-user/aggregate analytics (admin view) — scoped to the current user's own data only, consistent with `01-auth.md`.

## API

| Method | Path | Response |
|---|---|---|
| GET | `/api/analytics/summary` | `{ totalRuns, successRate, avgDurationMs, runsByDay: [{date, count}], topNodeTypes: [{type, count}] }` |

Computed with MongoDB aggregation queries over `Run`/`nodeResults`, scoped to `req.userId`; no need for a separate analytics datastore or pre-computed rollup tables at this data volume.

## UI Behavior

- New "Analytics" page/nav item.
- Stat tiles for totals (total runs, success rate, avg duration) plus the two charts (runs-over-time, top node types).
- A date-range filter (e.g. last 7/30/90 days) — simple client-side dropdown re-querying the API with query params.

## Edge Cases & Error Handling

- Zero runs yet — show an empty state ("Run a workflow to see analytics here"), not broken/empty charts.

## Acceptance Criteria

- [ ] Dashboard reflects actual run history accurately (spot-check counts against Run History list).
- [ ] Changing the date range filter updates all charts/tiles consistently.
- [ ] A brand-new user with zero runs sees a sensible empty state, not errors.
