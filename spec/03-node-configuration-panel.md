# Spec: Node Configuration Panel

**Status:** MVP
**Milestone:** M1
**Depends on:** `02-workflow-builder-canvas.md`, `05-agent-tool-providers.md`

## Summary

A side panel that opens when a node is selected on the canvas, letting the user configure that node's behavior. What fields appear depends on the node's type.

## Goals

- Agent node: set a name/label and a "system prompt" (freeform text — used by the mock provider for templating and, if `LLMAgentProvider` is active, as the actual prompt; see `05`).
- Tool node: pick a tool type from a fixed list (e.g. `fake-weather`, `calculator`, `fake-search`) and optionally override its mock parameters (e.g. simulated latency range, simulated failure rate — see `17-failure-injection.md` for the full stretch version of this).
- Condition node: an expression referencing the previous node's output (e.g. `output.length > 100`), evaluated with a small safe expression evaluator (not raw `eval`).
- Start/End nodes: label only, no functional config.

## Non-goals

- A general-purpose scripting/code editor for agents or conditions.
- Validating LLM prompt quality — the panel just stores text.

## UI Behavior

- Opens as a right-hand drawer/panel when a node is clicked; closes on deselect or clicking elsewhere on the canvas.
- Changes apply to the in-memory graph state immediately (canvas node label updates live) but only persist to the backend on explicit Save (`04`).
- Tool type dropdown is populated from the backend's registered tool list (`05`) so adding a new mock tool server-side automatically makes it available here.

## Data Shape (stored in `node.data.config`)

```
// Agent
{ label: string, systemPrompt: string }

// Tool
{ label: string, toolType: string, mockOverrides?: { latencyMs?: [min,max], failureRate?: number } }

// Condition
{ label: string, expression: string }

// Start / End
{ label: string }
```

## Edge Cases & Error Handling

- Empty/invalid condition expression → block save of that node's config with an inline error, don't silently default to `true`/`false`.
- Unknown `toolType` (e.g. after a tool was removed from the registry) → surface a warning on the node and in the panel.

## Acceptance Criteria

- [ ] Selecting each node type shows the correct fields.
- [ ] Editing a field updates the node's label/appearance on the canvas without needing a save.
- [ ] An invalid condition expression is rejected with a clear inline error.
- [ ] The Tool type dropdown reflects whatever tools are registered in the backend (`05`).
