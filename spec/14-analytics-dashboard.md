# Spec: Analytics Dashboard

**Status:** Stretch
**Milestone:** M3
**Depends on:** `11-execution-history.md`

> **Revised in phase 3:** Scoped per workspace ([`22`](22-workspaces-multitenancy.md)); tool usage groups by `integration`/`action` ([`26`](26-integration-framework.md)); live refresh via `run:status_changed`, a per-workflow view and `nodeStats` ([`35`](35-run-operations.md)); the Usage & plan page reuses its chart components ([`33`](33-fair-queue-and-quotas.md)).

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
| GET | `/api/analytics/summary?days=7\|30\|90` | `{ rangeDays, since, totalRuns, statusBreakdown, successRate, avgDurationMs, medianDurationMs, runsByDay, runsByTrigger, topNodeTypes, topToolTypes }` |

Computed with MongoDB aggregation queries scoped to `req.userId`; no separate analytics datastore or pre-computed rollups at this volume.

Decisions that fell out of building it:

- **Everything is bucketed in UTC.** `$dateToString` buckets in UTC unless given a timezone, so building the day list from *local* midnight silently shifts the whole series — in UTC+5:30 it pushed every key back a day and dropped today's runs off the chart entirely. One clock throughout, and the page says so.
- **`successRate` is over *finished* runs**, not all runs; counting in-flight ones would drag the number down for no reason while a run is still going. `null` (not `0`) when nothing has finished, so the UI can show "—" rather than a misleading 0%.
- **Node/tool-type usage is design-time**, aggregated over `Workflow.nodes` — this spec asks for "most-used types *across all workflows*". Deriving it from runs would mean joining every `nodeResult` back to its workflow's node list to recover a type that `nodeResults` doesn't store.
- `runsByDay` is zero-filled across the whole range so a quiet day reads as zero rather than as a gap the chart interpolates over.
- `runsByTrigger` and `medianDurationMs` are additions: with four trigger types live after `12`/`13`/`21`, "where do runs come from?" is a real question, and a median is far less skewed than a mean by one slow run.

## UI Behavior

- New "Analytics" page/nav item.
- Stat tiles for totals (total runs, success rate, avg + median duration), a runs-over-time area chart, and four supporting panels (outcomes, triggers, node types, tool types).
- A date-range filter (7/30/90 days) in one row above the charts, re-querying the API.

Visualization choices, per the data-viz method:

- **Outcomes are one labelled meter per status, not a stacked bar.** The status palette's `good` and `critical` steps are only ΔE 4.1 apart under deuteranopia, so green and red segments sitting flush together would be indistinguishable to a red-green colourblind reader. Each status gets its own row with an icon, a word and a count, so hue is reinforcement rather than the message. `warning` is sub-3:1 on white by design; the label relieves it and a hairline ring keeps a thin fill visible.
- **One hue for the bars.** Node types, tool types and triggers are magnitude comparisons where the label carries identity, so a categorical palette would be noise. Colours are the reference palette's blue, re-stepped for dark (`#2a78d6` → `#3987e5`) rather than reused, and defined as CSS variables so SVG marks follow the theme class with no re-render.
- **Linear interpolation, not a spline.** These are discrete daily counts; a monotone curve invents smooth intermediate values for days that never existed.
- **No entry animation.** Recharts reveals a series by animating a clip rect from zero width — noise on every range change, and it leaves the chart blank wherever frames don't advance (screenshots, exports, reduced-motion).
- **A table view** behind a "Show data" toggle on the time series: the accessibility fallback any chart with sub-3:1 marks owes its reader.

## Edge Cases & Error Handling

- Zero runs yet — show an empty state ("Run a workflow to see analytics here"), not broken/empty charts.

## Acceptance Criteria

- [ ] Dashboard reflects actual run history accurately (spot-check counts against Run History list).
- [ ] Changing the date range filter updates all charts/tiles consistently.
- [ ] A brand-new user with zero runs sees a sensible empty state, not errors — and no `NaN`, `Infinity` or `undefined` anywhere in the UI.
- [ ] Today's runs appear in the chart (the UTC/local bucketing trap).
- [ ] Axis ticks thin out with the range so 90 days of labels never collide.
- [ ] The time series offers a table view of the same numbers.
