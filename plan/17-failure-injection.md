# Plan: Configurable Failure Injection

**Spec:** [`spec/17-failure-injection.md`](../spec/17-failure-injection.md)
**Depends on:** `05-agent-tool-providers`, `07-async-job-queue`

> **Status: complete.** Most of the backend already existed from phase 1 (`withMockBehavior`
> read `mockOverrides.failureRate` and threw `SimulatedToolFailure`); `19` supplied the
> per-node `maxAttempts` and the cache exception. Verified over HTTP (100% → 4 attempts then
> a failed run with 3 backoff lines at 500/1000/2000ms; 0% → 5 clean runs) plus a cache-free
> handler check (0/300, 300/300, 22/300 at the 10% env default).
>
> Two things beyond the original task list, now in `spec/17`: the log pane never rendered a
> **finished** run's logs at all (it only ever filled from live socket events, so history
> showed "No logs yet..."), and the panel now shows the server default behind an unset
> override instead of an ambiguous empty control.

## Backend Tasks

- [x] Global default failure rate constant/env var (e.g. `DEFAULT_TOOL_FAILURE_RATE`, defaulting to something small like `0.1`)
- [x] In each `ToolHandler.run()` (`05`) — check `Math.random() < (config.mockOverrides?.failureRate ?? DEFAULT_TOOL_FAILURE_RATE)` before producing normal output; on hit, reject with a distinct `SimulatedToolFailure` error
- [x] Confirm the queue's (`07`) retry logic already handles `SimulatedToolFailure` like any other rejection — no special-casing needed there
- [x] Ensure `node:update` log lines for a simulated failure are phrased distinctly (e.g. `[simulated failure] ...`) so the engine (`06`) tags them appropriately in `nodeResults[i].logs`

## Frontend Tasks

- [x] Node Configuration Panel (`03`) — slider/number input (0–100%) for a Tool node's `failureRate`, defaulting to showing the global default when unset
- [x] Run Monitor / History log rendering — visually distinguish `[simulated failure]` log lines (e.g. different color/icon) from other log lines

## Verification

- [x] Setting a Tool node's failure rate to 100% reliably produces a failed run after exhausting retries
- [x] Setting it to 0% reliably produces success with no flaky failures leaking in from the global default
- [x] Logs clearly distinguish simulated failures from other log lines in both live monitor and history views
