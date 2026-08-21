# Plan: Agent & Tool Providers

**Spec:** [`spec/05-agent-tool-providers.md`](../spec/05-agent-tool-providers.md)
**Depends on:** `00-project-setup`

## Backend Tasks

- [ ] `providers/AgentProvider.js` — interface/contract doc comment only (`run(agentConfig, input) → { output, logs }`)
- [ ] `providers/MockAgentProvider.js` — templated/rule-based output from `agentConfig.systemPrompt` + `input`, `await delay(randomMs)`, small random failure chance
- [ ] `providers/LLMAgentProvider.js` — calls Anthropic Messages API (`@anthropic-ai/sdk`, added as a dependency only when this file is built) using `systemPrompt` as system + `input` as the user message; same return contract
- [ ] `config/agentProvider.js` — `getAgentProvider()` factory, reads `AGENT_PROVIDER` env once at startup; throws a clear startup error if `AGENT_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` is missing
- [ ] `tools/ToolRegistry.js` — registry map of `toolType → ToolHandler`
- [ ] Mock tool handlers: `tools/fakeWeather.js`, `tools/calculator.js`, `tools/fakeSearch.js` — each `run(config, input) → { output }`, artificial latency, configurable failure rate (hook point for `17`)
- [ ] `GET /api/tools` route (used by `03`) — lists registry entries `{ type, label }`
- [ ] Unit-test-by-hand (manual script or quick console check) that `MockAgentProvider` and each tool handler behave as expected before wiring into the execution engine (`06`)

## Frontend Tasks

None directly — `03-node-configuration-panel` consumes `GET /api/tools`; no other UI surface for this spec itself.

## Verification

- [ ] With `AGENT_PROVIDER` unset (defaults to mock), the server starts with no API key and agent calls return mock output
- [ ] Setting `AGENT_PROVIDER=anthropic` without `ANTHROPIC_API_KEY` fails fast at startup with a clear error
- [ ] Setting both correctly routes an agent call through a real LLM response
- [ ] `GET /api/tools` reflects the actual registered tool handlers
- [ ] Each mock tool simulates latency and can be made to fail (manually crank up its failure rate temporarily to confirm)
