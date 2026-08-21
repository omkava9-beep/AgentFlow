# Spec: Agent-to-Agent Handoff

**Status:** Stretch
**Milestone:** M3
**Depends on:** `05-agent-tool-providers.md`, `06-execution-engine.md`

## Summary

A more dynamic multi-agent pattern layered on top of the static DAG model: instead of a fixed next-edge, an Agent node's output can select which of several candidate next agents actually runs — simulating delegation ("route this to the right specialist agent").

## Goals

- A "Handoff" agent node type (or a flag on a regular Agent node) that has multiple outgoing edges, each labeled with a target agent name/key.
- The provider's mock/LLM output includes a `handoffTarget` field (for the mock provider, chosen via simple keyword rules against the input; for `LLMAgentProvider`, asked for explicitly in the prompt, e.g. "respond with which of [A, B, C] should handle this next").
- The execution engine (`06`) treats a Handoff node like a Condition node: only the edge matching `handoffTarget` is taken, the rest are `skipped`.

## Non-goals

- Arbitrary N-level recursive delegation chains beyond what the static DAG already expresses — the *set* of possible next agents is still fixed at design time (drawn on the canvas); only *which one* is chosen dynamically.
- Agents "creating" new agents at runtime.

## Data Model

Handoff node config (in `node.data.config`, alongside the regular Agent shape):
```
{ label, systemPrompt, isHandoff: true, candidates: string[] }  // candidates = edge labels
```

`nodeResults` entry gains: `handoffTarget: string`.

## UI Behavior

- Node Configuration Panel (`03`) shows a "Handoff candidates" list editor when a node is marked as a handoff agent.
- Sync is one-directional and deliberately partial: **renaming** a candidate rewrites any outgoing edge already labelled with the old name (it's the same branch being renamed, so letting them drift would just manufacture a warning), but **adding or removing** a candidate does not touch edges. That drift is real, and `20`'s validation panel reports it rather than having a config edit silently rewire the graph. The editor marks each candidate green/amber for whether an edge currently uses it.
- Turning the handoff flag off preserves `candidates`, so toggling it back is lossless.
- Run Monitor (`09`) highlights the taken handoff edge distinctly — animated and accented, with the ruled-out edges dashed and faded. Condition nodes get the identical treatment, since both resolve to exactly one outgoing edge. Without it a routing decision is invisible on the graph: the untaken nodes just go grey, and you can't tell a routing choice from an upstream failure.
- The node's result carries a `⇄ target` chip so the chosen branch is readable without parsing logs.

## Edge Cases & Error Handling

- Provider returns a `handoffTarget` that doesn't match any of the node's actual outgoing edge labels — treat as a node failure with a clear log message ("agent selected unknown handoff target: X"), don't silently pick a default.

## Acceptance Criteria

- [ ] A Handoff node with 3 candidate agents routes execution to exactly one of them based on (mocked) output, skipping the other two.
- [ ] An invalid/unmatched handoff target fails the node clearly rather than silently defaulting.
- [ ] Works identically in shape whether `AGENT_PROVIDER` is `mock` or `anthropic` — only how `handoffTarget` gets decided differs.
- [ ] Renaming a candidate renames its matching edge label; adding or removing one leaves edges alone and surfaces a validation warning instead.

`npm run check:engine` (in `server/`) covers the routing and invalid-target criteria.
