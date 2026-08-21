# Plan: Configurable Failure Injection

**Spec:** [`spec/17-failure-injection.md`](../spec/17-failure-injection.md)
**Depends on:** `05-agent-tool-providers`, `07-async-job-queue`

## Backend Tasks

- [ ] Global default failure rate constant/env var (e.g. `DEFAULT_TOOL_FAILURE_RATE`, defaulting to something small like `0.1`)
- [ ] In each `ToolHandler.run()` (`05`) — check `Math.random() < (config.mockOverrides?.failureRate ?? DEFAULT_TOOL_FAILURE_RATE)` before producing normal output; on hit, reject with a distinct `SimulatedToolFailure` error
- [ ] Confirm the queue's (`07`) retry logic already handles `SimulatedToolFailure` like any other rejection — no special-casing needed there
- [ ] Ensure `node:update` log lines for a simulated failure are phrased distinctly (e.g. `[simulated failure] ...`) so the engine (`06`) tags them appropriately in `nodeResults[i].logs`

## Frontend Tasks

- [ ] Node Configuration Panel (`03`) — slider/number input (0–100%) for a Tool node's `failureRate`, defaulting to showing the global default when unset
- [ ] Run Monitor / History log rendering — visually distinguish `[simulated failure]` log lines (e.g. different color/icon) from other log lines

## Verification

- [ ] Setting a Tool node's failure rate to 100% reliably produces a failed run after exhausting retries
- [ ] Setting it to 0% reliably produces success with no flaky failures leaking in from the global default
- [ ] Logs clearly distinguish simulated failures from other log lines in both live monitor and history views
