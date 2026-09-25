# Spec: Configurable Failure Injection

**Status:** Stretch
**Milestone:** M3
**Depends on:** `05-agent-tool-providers.md`, `07-async-job-queue.md`

> **Revised in phase 3:** Failure injection applies to sandbox calls only; `maxAttempts` applies to live calls too — see [`26`](26-integration-framework.md).

## Summary

Lets a user deliberately configure a Tool node's simulated failure rate so retry/backoff behavior (`07`) is easy to demonstrate on demand, instead of relying on the small built-in random failure chance to happen to show up during a demo.

## Goals

- Per-Tool-node override (already stubbed as `mockOverrides.failureRate` in `03-node-configuration-panel.md`) — a 0–100% chance that a given tool invocation simulates failure.
- A global default failure rate (env or config constant) applies when a node doesn't override it.
- The Run Monitor/History clearly shows when a failure was "expected" (i.e., a simulated failure) vs. would represent a real bug — in practice, since everything here is simulated, this just means labeling failed attempts as coming from the mock/failure-injection path in the logs, so it reads as intentional rather than confusing.

## Non-goals

- Failure injection for Agent node providers (kept simpler — only Tool nodes get this dial, matching where "external API flakiness" conceptually lives).
- Fine-grained failure *types* (timeout vs. 500 vs. malformed response) — a single generic simulated failure is enough to exercise retry/backoff.

## Design

`ToolHandler.run()` (from `05`) checks `Math.random() < failureRate` before producing its normal mock output; on a "hit," it rejects with a clear `SimulatedToolFailure` error that the queue (`07`) retries per its normal policy.

## UI Behavior

- Node Configuration Panel: a slider/number input (0–100%) for a Tool node's failure rate, defaulting to the global default if unset.
- Run Monitor log lines for a simulated failure are phrased distinctly, e.g. `[simulated failure] fake-weather call failed (attempt 1/3), retrying in 500ms...`.
- Both override fields are *overrides*, not values: unset means "use the server default", and the panel shows what that default actually is (`GET /api/tools` returns it) so an empty control never reads as `0`.
- The log pane must seed itself from the run's persisted `nodeResults[].logs`, not only from the live socket stream. Otherwise this spec's third acceptance criterion is unmeetable for a finished run: its logs are in the database and its live events are long gone, so the pane renders empty.

## Edge Cases & Error Handling

- Failure rate set to 100% — the node will always exhaust retries and fail; this is intentional/valid (useful for demoing the failed-run path end-to-end), not something to block or warn about beyond maybe a light UI hint.

## Acceptance Criteria

- [ ] Setting a Tool node's failure rate to 100% reliably produces a failed run after exhausting retries.
- [ ] Setting it to 0% reliably produces success (no flaky failures leaking in from the global default).
- [ ] Logs clearly distinguish simulated failures from other log lines.
- [ ] A finished run reopened from Run History shows its logs, including the retry lines.
- [ ] An unset failure rate displays the server default rather than `0`.
