# Plan: Node Configuration Panel

**Spec:** [`spec/03-node-configuration-panel.md`](../spec/03-node-configuration-panel.md)
**Depends on:** `02-workflow-builder-canvas`, `05-agent-tool-providers` (for the tool-type list)

## Backend Tasks

- [ ] `GET /api/tools` — returns the list of registered tool types from the `ToolRegistry` (`05`), e.g. `[{ type: 'fake-weather', label: 'Fake Weather' }, ...]`, so the panel's dropdown stays in sync with what's actually implemented server-side

## Frontend Tasks

- [ ] `components/NodeConfigPanel.jsx` — right-hand drawer, opens when `workflowStore.selectedNodeId` is set, closes on deselect
- [ ] Per-type field sets:
  - [ ] Agent: `label` (text), `systemPrompt` (textarea)
  - [ ] Tool: `label` (text), `toolType` (dropdown fed by `GET /api/tools`), optional `mockOverrides.latencyMs` (min/max) and `failureRate` (see `17` for the full slider UI — a simple number input is enough here)
  - [ ] Condition: `label` (text), `expression` (text input, e.g. `output.length > 100`)
  - [ ] Start/End: `label` only
- [ ] Small safe-expression validator for Condition nodes (e.g. via a whitelisted mini-parser or a constrained `new Function` sandbox with only `output` in scope) — reject unparseable/unsafe expressions inline
- [ ] Live-update the node's label/appearance on the canvas as fields change (no save required to preview)
- [ ] Persist config into `workflowStore`'s node `data.config` shape matching the spec
- [ ] Handle unknown `toolType` (e.g. tool removed from registry since last edit) — show a warning badge on the node and in the panel

## Verification

- [ ] Selecting each node type shows the correct field set
- [ ] Editing a field updates the canvas node's label immediately
- [ ] Entering an invalid condition expression shows an inline error and blocks acceptance
- [ ] Tool dropdown options match whatever `GET /api/tools` returns
