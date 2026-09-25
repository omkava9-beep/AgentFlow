# Spec: Agent & Tool Providers

**Status:** MVP (mock provider) — real `LLMAgentProvider` implementation is Stretch
**Milestone:** M1 (interface + mock) / M3 (real LLM option)
**Depends on:** —

> **Revised in phase 3:** `ToolRegistry` is replaced by the manifest-based `IntegrationRegistry` with sandbox/live actions ([`26`](26-integration-framework.md), [`27`](27-integration-catalog.md)); agents can call tools and the provider contract gains an engine-driven `step()` ([`37`](37-mcp.md)). Tools are live by default, not mocked. An `OpenAIAgentProvider` (Chat Completions with function calling) serves both OpenRouter (`AGENT_PROVIDER=openrouter`, the free-tier provider used for the demo) and OpenAI (`AGENT_PROVIDER=openai`); Anthropic's `LLMAgentProvider` stays as an alternative.

## Summary

Defines the pluggable abstraction for how an Agent node's "reasoning" is executed, and the mock-tool registry Tool nodes draw from. This is the piece that lets the project run entirely offline/free by default, with a documented, low-effort path to a real LLM later. See `PRODUCT.md` § "Mock-to-real upgrade path" for the product-level rationale.

## Goals

- A single `AgentProvider` interface with a `run(agentConfig, input) → { output, logs }` contract.
- `MockAgentProvider`: default implementation — deterministic-ish templated/rule-based output derived from `agentConfig.systemPrompt` and `input`, artificial latency, small randomized failure chance.
- `LLMAgentProvider`: calls a real LLM API (e.g. Anthropic Messages API) using `agentConfig.systemPrompt` as the system prompt and `input` as the user message; same `{ output, logs }` contract.
- Provider selection happens once, at process startup, via env vars — never branched on ad hoc in route/engine code.
- A small `ToolRegistry` of mocked tools (`fake-weather`, `calculator`, `fake-search`, etc.), each with a `run(config, input) → { output }` contract, artificial latency, and a configurable failure rate (see `17-failure-injection.md`). Tools are **always mocked** — no real external API calls, regardless of `AGENT_PROVIDER`.

## Non-goals

- Real tool integrations (real weather/search APIs) — out of scope entirely, mocked forever in this project.
- Multi-provider support beyond mock + one real LLM vendor (no need to abstract over multiple real LLM vendors).
- Streaming token-by-token output from the LLM provider — a single completed `output` per agent run is enough for this project's execution model.

## Env Configuration

```
AGENT_PROVIDER=mock        # default; no key required
# AGENT_PROVIDER=anthropic
# ANTHROPIC_API_KEY=sk-...
```

Read once in a config module (e.g. `server/src/config/agentProvider.js`) that exposes `getAgentProvider()`, used by the execution engine (`06`). Missing `ANTHROPIC_API_KEY` while `AGENT_PROVIDER=anthropic` should fail fast at startup with a clear error, not fail silently per-run.

## Interfaces

```ts
// conceptual shape, not literal TS in this JS project
interface AgentProvider {
  run(agentConfig: { systemPrompt: string, label: string }, input: any): Promise<{ output: any, logs: string[] }>
}

interface ToolHandler {
  run(config: { toolType: string, mockOverrides?: object }, input: any): Promise<{ output: any }>
}
```

## Edge Cases & Error Handling

- `LLMAgentProvider` real API errors (rate limit, network failure) surface through the same retry/backoff path as a mocked tool failure (`07`) — the execution engine shouldn't need to know which provider is active.
- Switching `AGENT_PROVIDER` requires a server restart (env is read at startup) — this is acceptable; no need for hot-reload of provider config.

## Acceptance Criteria

- [ ] With `AGENT_PROVIDER=mock` (or unset), the app runs with zero external API calls and no API key.
- [ ] Setting `AGENT_PROVIDER=anthropic` + a valid key routes Agent node execution through a real LLM call, with no other code changes.
- [ ] Tool nodes never make real network calls to third parties in either mode.
- [ ] Adding a new mock tool to the `ToolRegistry` makes it selectable in the Node Configuration Panel (`03`) without touching the execution engine.
