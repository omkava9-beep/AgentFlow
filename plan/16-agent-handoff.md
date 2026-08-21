# Plan: Agent-to-Agent Handoff

**Spec:** [`spec/16-agent-handoff.md`](../spec/16-agent-handoff.md)
**Depends on:** `05-agent-tool-providers`, `06-execution-engine`

> **Status: complete.** The whole backend already existed — `executeRun` routed on
> `handoffTarget`, both providers produced one, and `19` added `nodeResults.handoffTarget`
> — so this was the UI half. Verified by 6 new engine checks (3-candidate routing, invalid
> target failing permanently without retries and without defaulting to the only edge),
> 18 store checks on candidate/edge sync, and a 14-check browser pass (canvas badge,
> candidates editor, live edge-label rename, one animated taken edge against two dashed
> ones, chip agreeing with the log line).
>
> Two bugs surfaced while testing, both fixed:
> - `loadWorkflow` reset the history stacks but **not** the coalesce window, so the first
>   edit after opening a workflow could be folded into the previous workflow's 500ms window
>   and end up with no undo entry.
> - `MockAgentProvider` logged `routed based on keyword match` even when it had picked a
>   candidate at random — a run log claiming a reason it didn't use.
>
> `executeRun` also gained a per-run `timeoutMs` override: the deadline was process-global,
> so the timeout check starved every other run in the same process (which is what made the
> handoff check fail on first run — not an engine fault).

## Backend Tasks

- [x] Extend Agent node config shape with `isHandoff: true`, `candidates: string[]`
- [x] Extend `MockAgentProvider` — when `isHandoff`, choose a `handoffTarget` via simple keyword rules against `input`, matching one of `candidates`
- [x] Extend `LLMAgentProvider` — when `isHandoff`, append an instruction to the prompt asking it to name which candidate should handle it next; parse the response for a matching candidate name
- [x] In `engine/executeRun.js` (`06`) — treat a Handoff node like a Condition node: only the edge whose label matches `handoffTarget` is taken, others `skipped`
- [x] Handle invalid/unmatched `handoffTarget` (provider returned something not in `candidates`) — mark the node `failed` with a clear log message, don't default silently
- [x] Extend `nodeResults` schema with `handoffTarget`

## Frontend Tasks

- [x] Node Configuration Panel (`03`) — "Handoff candidates" list editor when a node is marked as a handoff agent; keep edge labels in sync with candidate names as they're added/removed
- [x] Canvas — visually distinguish a Handoff node from a regular Agent node (icon/badge)
- [x] Run Monitor (`09`) — highlight the taken handoff edge distinctly, same treatment as a Condition's taken branch if that exists

## Verification

- [x] A Handoff node with 3 candidates routes to exactly one based on (mocked) output, others `skipped`
- [x] An invalid/unmatched handoff target fails the node clearly rather than defaulting
- [x] Behavior is identical in shape whether `AGENT_PROVIDER` is `mock` or `anthropic` — only how `handoffTarget` is decided differs
