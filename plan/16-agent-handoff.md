# Plan: Agent-to-Agent Handoff

**Spec:** [`spec/16-agent-handoff.md`](../spec/16-agent-handoff.md)
**Depends on:** `05-agent-tool-providers`, `06-execution-engine`

## Backend Tasks

- [ ] Extend Agent node config shape with `isHandoff: true`, `candidates: string[]`
- [ ] Extend `MockAgentProvider` — when `isHandoff`, choose a `handoffTarget` via simple keyword rules against `input`, matching one of `candidates`
- [ ] Extend `LLMAgentProvider` — when `isHandoff`, append an instruction to the prompt asking it to name which candidate should handle it next; parse the response for a matching candidate name
- [ ] In `engine/executeRun.js` (`06`) — treat a Handoff node like a Condition node: only the edge whose label matches `handoffTarget` is taken, others `skipped`
- [ ] Handle invalid/unmatched `handoffTarget` (provider returned something not in `candidates`) — mark the node `failed` with a clear log message, don't default silently
- [ ] Extend `nodeResults` schema with `handoffTarget`

## Frontend Tasks

- [ ] Node Configuration Panel (`03`) — "Handoff candidates" list editor when a node is marked as a handoff agent; keep edge labels in sync with candidate names as they're added/removed
- [ ] Canvas — visually distinguish a Handoff node from a regular Agent node (icon/badge)
- [ ] Run Monitor (`09`) — highlight the taken handoff edge distinctly, same treatment as a Condition's taken branch if that exists

## Verification

- [ ] A Handoff node with 3 candidates routes to exactly one based on (mocked) output, others `skipped`
- [ ] An invalid/unmatched handoff target fails the node clearly rather than defaulting
- [ ] Behavior is identical in shape whether `AGENT_PROVIDER` is `mock` or `anthropic` — only how `handoffTarget` is decided differs
