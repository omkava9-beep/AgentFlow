# Plan: Analytics Dashboard

**Spec:** [`spec/14-analytics-dashboard.md`](../spec/14-analytics-dashboard.md)
**Depends on:** `11-execution-history`

> **Status: complete.** Verified by `npm run check:analytics` (29 checks against seeded
> fixtures with exact statuses, durations, triggers and dates) plus 15 browser checks and a
> screenshot review in both themes at all three ranges.
>
> Two real bugs the checks caught:
> - **`runsByDay` dropped today's runs.** `$dateToString` buckets in UTC while the day list
>   was built from local midnight; in UTC+5:30 that shifted every key back a day and omitted
>   today entirely. Now UTC throughout.
> - **The area chart rendered blank.** Recharts animates a series in from a zero-width clip
>   rect, and it stays near frame zero wherever rAF doesn't advance — the clip rect measured
>   19.95px against a ~1030px plot. Animation disabled, which is also the right call for a
>   dashboard.
>
> Chart design follows the data-viz method: the palette was run through the validator against
> this app's real surfaces, which is what ruled out a stacked status bar (good↔critical is
> ΔE 4.1 under deuteranopia). Details in `spec/14`.

## Backend Tasks

- [x] `controllers/analyticsController.js` — `getSummary(userId, dateRange)`
- [x] MongoDB aggregation pipeline(s) over `Run` (scoped to `ownerId`, filtered by date range):
  - [x] `totalRuns`, `successRate` (success / total)
  - [x] `avgDurationMs` (`finishedAt - startedAt` average)
  - [x] `runsByDay` — group by day for the runs-over-time chart
  - [x] `topNodeTypes` — unwind `nodeResults`/join against workflow node types, group + count
- [x] `GET /api/analytics/summary?range=7|30|90` route, behind `requireAuth`

## Frontend Tasks

- [x] `pages/Analytics.jsx` — new nav item/route
- [x] Stat tiles: total runs, success rate, avg duration
- [x] Runs-over-time chart (Recharts line/area) from `runsByDay`
- [x] Top node types chart (Recharts bar) from `topNodeTypes`
- [x] Date-range dropdown (7/30/90 days) re-querying `GET /api/analytics/summary`
- [x] Empty state for zero-runs users ("Run a workflow to see analytics here")

## Verification

- [x] Numbers on the dashboard match a manual spot-check against Run History for the same user/date range
- [x] Changing the date range updates all tiles/charts consistently
- [x] A brand-new user with zero runs sees the empty state, not broken charts/errors
