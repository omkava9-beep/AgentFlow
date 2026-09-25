# Spec: MCP Servers & Agent Tool Use

**Status:** Phase 3 — Tier 1
**Milestone:** M4
**Depends on:** `24-socket-auth-and-namespaced-events.md`, `25-secrets-and-connections.md`, `26-integration-framework.md`, `27-integration-catalog.md`
**Revises:** `05-agent-tool-providers.md` (agents can call tools; the provider contract gains a step-based form), `06-execution-engine.md` (an agent node can span several queue jobs), `16-agent-handoff.md` (handoff agents may use tools before deciding)

## Summary

Makes AgentFlow an **MCP client**. A workspace can register [Model Context Protocol](https://modelcontextprotocol.io) servers as connections, and every tool a server offers becomes something a workflow can use in two ways:

1. **The MCP Tool node.** A tool node whose action is one MCP tool, with a config form generated from the tool's JSON Schema.
2. **Agent tool use.** An agent node is given a set of tools (MCP tools *and* the integration actions from `27`) and decides during its reasoning which to call, with what arguments, and how many times.

The second is what `definition.md` actually asks for ("agents collaborate to accomplish complex tasks by using tools, APIs, and external services"). Until now agents have only produced text. This spec lets them act, and it does so **through AgentFlow's own queue**, so every tool call an agent makes gets retries, caching, logs and a live timeline in the monitor.

The scope is tools only, as a client only. AgentFlow does not act as an MCP server (that role was considered and dropped), and resources, prompts, sampling and elicitation are out of scope.

## Goals

### 1. MCP servers as connections

An MCP server is a `Connection` (`25`) with `integration: 'mcp'`. It supports two transports:

| Transport | Who can add it | Config | Credentials (vault) |
|---|---|---|---|
| **Streamable HTTP** (remote) | `connections:manage` | `{ transport: 'http', url, headerName? }` | `{ authHeader? }`, sent as `headerName` (default `Authorization`) |
| **stdio** (local process) | `connections:manage` | `{ transport: 'stdio', allowlistId }` | none |

**stdio servers come only from `server/mcp-servers.json`,** an operator-maintained allowlist:

```json
[
  { "id": "agentflow-demo", "name": "AgentFlow Demo Tools", "description": "Customers, orders, KB, tickets (sandbox data)",
    "command": "node", "args": ["src/mcp/demoServer.js"], "env": { "MONGODB_URI": "${MONGODB_URI}" },
    "injectWorkspaceContext": true, "sandboxSafe": true }
]
```

- A tenant picks an `allowlistId` from a list and **never supplies a command, args or env**. A stdio server is a process the backend spawns on its own machine, so accepting a tenant-supplied command would let any editor run arbitrary code on the host (C4).
- `${VAR}` placeholders in `env` are resolved from the **server's** environment when the process is spawned. The spawned process gets only the env the entry lists plus `PATH`, never the whole server environment (which contains `JWT_SECRET` and `SECRETS_MASTER_KEY`).
- The file is read once at startup. Changing it requires a restart, the same way `AGENT_PROVIDER` works.

**Remote servers go through the SSRF guard.** The HTTP transport must use `27`'s `safeRequest` for every request, including SSE streams, so the connect-time IP check and redirect re-checking apply to MCP exactly as they do to the HTTP tool. The MCP SDK's `StreamableHTTPClientTransport` accepts a custom `fetch` in recent versions. **The implementation must confirm that hook exists in the pinned SDK version** and pass a `safeFetch` adapter built on `safeRequest`. If the hook is missing or doesn't cover every request the transport makes, write a thin transport of our own on `safeRequest` instead of weakening the guard. For MCP calls the size cap applies per message (1 MB), and a single tool call gets `MCP_CALL_TIMEOUT_MS` (default 30 s, longer than HTTP's 10 s because tools often do real work).

**The SDK loads lazily.** `@modelcontextprotocol/sdk` is imported with `await import()` the first time an MCP connection is used, in the same way `LLMAgentProvider` loads `@anthropic-ai/sdk`. A workspace with no MCP connections never loads it.

### 2. `McpPool`: one client per connection

`server/src/mcp/McpPool.js` is an in-process singleton, like the queue and cache (`CLAUDE.md`):

- **Lazy connect.** The first `listTools` or `callTool` on a connection opens it and runs `initialize`. Concurrent first calls share one connect promise.
- **Idle close** after 5 minutes without a call (the stdio child process is killed, the HTTP session closed).
- **Reconnect with backoff** (1 s, 2 s, 4 s … capped at 30 s) after a transport error or a stdio process exit. A call made during backoff fails as *retryable*, so the queue's own retry covers it.
- **Concurrent calls share the connection.** MCP is JSON-RPC with request ids, so the pool doesn't serialize calls.
- **Cancellation.** When a run is cancelled, or a call hits its timeout, the pool sends `notifications/cancelled` for the in-flight request.
- **Invalidation.** Editing a connection's config or credentials, or deleting the connection, closes its pool entry. If the server sends `notifications/tools/list_changed`, the cached tool list for that connection is dropped.

### 3. Discovery, and tools as dynamic actions

- `tools/list` results are cached in the TTL cache per connection (key `mcp:tools:<connectionId>`, 5 minutes). They're also saved on the connection as `config.toolsSnapshot`, so nodes still validate and render after a restart, or while the server is offline, without reconnecting.
- A **Refresh tools** action re-runs discovery and replaces the snapshot.
- In `26`'s registry, `mcp` is one catalogue entry with **no static actions** and `dynamicActions: true`. Its actions are resolved per connection from the snapshot, and each MCP tool becomes a manifest action at runtime:
  - `id` = the tool name, `name` = `title || name`, `description`, `configSchema` (mapped below)
  - `outputSample` built from the tool's `outputSchema`, if it has one
  - `cacheable` = `annotations.readOnlyHint === true`
  - `sideEffect` = `!(annotations.readOnlyHint === true)`
  - `live` = it calls the tool through the pool
- The **tool node config** is `{ label, integration: 'mcp', action: '<toolName>', connectionId, params, mockOverrides }`, the same shape as any other integration action (`26`). `params` supports `{{input.x}}` templating.

**JSON Schema → `configSchema` mapping.** Deliberately shallow, like `21`'s form renderer:

| `inputSchema` property | Form field |
|---|---|
| `string` (with `format: date`/`email`/`uri` as a placeholder hint) | `text`, or `textarea` if `maxLength > 200` or the description mentions "body" or "content" |
| `number` / `integer` | `number` (`minimum`/`maximum` carried over) |
| `boolean` | `boolean` |
| `enum` (of strings) | `select` with those options |
| `required[]` | `required: true` |
| `default` | `default` |
| `object`, `array`, `$ref`, `oneOf`/`anyOf`/`allOf` | a **JSON editor** for that one property, validated against its sub-schema before saving and at run time |

A schema that is itself not an `object` (rare), or has more than 25 properties, renders as a single JSON editor for the whole argument object.

**Result mapping** (`tools/call`):

- If `structuredContent` is present, it's used as the node output as-is (it's schema-typed data).
- Otherwise the output is `{ text, content }`: `text` is every `text` block joined with blank lines, and `content` keeps the non-text blocks as **metadata only**: `{ type: 'image', mimeType, bytes }`, `{ type: 'resource', uri, mimeType }`. Binary data is never stored in a run document.
- **`isError: true` becomes a `PermanentFailure`** carrying the server's text. The tool ran and refused, and running it again won't change that. Transport errors, timeouts and pool reconnects are **retryable** (`07`).

### 4. Sandbox mode for MCP

The C2 mode rule applies. An MCP call is live when `INTEGRATIONS_LIVE` is on and the connection's mode is `live`. One exception: an allowlist entry marked **`sandboxSafe: true`** is always called, because it's a local process that AgentFlow ships and that only touches sandbox data. The bundled demo server is the only such entry.

Otherwise, in sandbox mode, **no MCP traffic happens at all.** The action returns a placeholder shaped from the tool's schema:

- It's built from `outputSchema` when the tool has one (each property filled with a type-appropriate sample, the same generator `26` uses for `outputSample`).
- Otherwise it's `{ text: '[sandbox] <tool> would be called with {...args}', sandbox: true }`.
- Discovery in sandbox mode serves the saved `toolsSnapshot` and never connects.

**Why placeholders and not a refusal:** `INTEGRATIONS_LIVE=false` has to mean "no external traffic", or it's useless as a kill switch for offline runs and deterministic checks. Returning a correctly-shaped placeholder keeps workflows that contain MCP nodes runnable end to end. Exempting `sandboxSafe` servers keeps `check:mcp` meaningful: it exercises a real protocol exchange without leaving the machine.

### 5. Agent tool use

**Configuration.** The agent node config gains `tools: [{ integration, action, connectionId }]`, which can hold MCP tools and any `26`/`27` integration action. There's a limit of **20 tools** per agent, because every tool definition costs model tokens on every step. The config panel shows a tool picker grouped by connection, with a search box.

**Side-effecting tools need an explicit opt-in.** An agent can only be given actions with `sideEffect: true` if the node has `allowSideEffects: true` (a checkbox, off by default, with a warning). For MCP, anything not marked `readOnlyHint` counts as side-effecting. Tool output is untrusted data, and a model that reads a hostile web page or ticket could be steered into calling a "send" tool. The Approval node (`32`) is the recommended guard in front of real consequences. That's the proportionate response for this project. There's no content filtering and no sandboxed reasoning.

**The engine drives the loop, not the provider.** The provider contract (`05`) gains a step-based form alongside the existing `run()`:

```
provider.step(agentConfig, state) → { type: 'final', output, logs, handoffTarget? }
                                  | { type: 'tool_calls', calls: [{ id, tool, args }], logs }
```

`engine/agentLoop.js` runs the loop:

1. Enqueue one **agent turn** job (`provider.step`).
2. On `tool_calls`, enqueue each call as its own **tool job**, running them in parallel.
3. Append the results to `state` and enqueue the next turn.
4. Stop on `final`, when the run is cancelled, or at the iteration cap.

**Why the loop lives in the engine:** if an agent node were one queue job that made nested tool calls on the same bounded queue, four agents waiting on their own tool calls would hold all four slots (`QUEUE_CONCURRENCY=4`) and **deadlock** the pool. With the loop in the engine, nothing holds a slot while it waits. As a side benefit, every turn and every tool call separately gets the queue's retries, `33`'s fair scheduling, cancellation checks between steps, and a line in the monitor.

- Agents **without** tools keep calling `run()`. Nothing changes for phase-1/2 workflows.
- A **tool call failure doesn't fail the node.** Once retries are exhausted, or on a permanent failure, the error goes back to the model as a tool result marked as an error, so the model can recover or explain. A **turn** failure (the provider itself failing after retries) does fail the node, as it does today.
- Tool results are **capped at `AGENT_TOOL_RESULT_MAX_CHARS`** (default 8 000) before they go back to the model, and the truncation is noted in the result. The full output is still recorded on the tool call, up to `27`'s 1 MB cap.
- Tool calls use the same cache rules as tool nodes: an MCP call is cacheable only if the tool is marked `readOnlyHint`, an integration action only if it's `cacheable`, and the key always includes `workspaceId` and `connectionId`. Agent turns themselves are never cached.

**`LLMAgentProvider`** runs a manual tool-use loop on the Anthropic Messages API:

- Tool definitions are built from each tool's `inputSchema`. Integration actions get an `input_schema` generated from their `configSchema`.
- Tool names are sanitized to `^[a-zA-Z0-9_-]{1,64}$` as `<connectionSlug>__<tool>`, so two servers that both offer `search` don't collide. `connectionSlug` is derived here, not stored: the connection's name lowercased, with non-alphanumerics collapsed to `_`, truncated to 20 characters, and the last 4 characters of its id appended if two connections in the agent's tool list would produce the same slug. Integration actions use `<integration>__<action>`. The loop keeps a map from each sanitized name back to its `{ integration, action, connectionId }`.
- When one response contains several `tool_use` blocks, they run in parallel and **all** their `tool_result` blocks go back in a single user message. Failed ones set `is_error: true`.
- **At most 8 steps.** When the cap is reached, one last request is sent with `tool_choice: { type: 'none' }` asking for a final answer. If that still doesn't produce one, the node fails with `Agent exceeded 8 tool-use steps`.
- A `refusal` stop reason fails the node permanently (`Model declined the request`). `max_tokens` is treated as a retryable turn failure.
- The model id moves out of the hardcoded string into the provider config module as `ANTHROPIC_MODEL` (default `claude-opus-5`). Request options such as thinking and effort also live there, never in engine code.

**`MockAgentProvider`** makes tool use work in the default, keyless mode, and **calls the chosen tools for real**:

- **Choosing a tool:** it tokenizes the input text and each tool's name (split on `_`, `-` and `.`) and description, and picks the tool with the most overlapping words. If nothing overlaps and the agent has exactly one tool, it uses that one. Otherwise it answers without a tool.
- **Filling arguments:** for each `inputSchema` property, it uses `input[prop]`, falling back to one level down into a fan-in object keyed by source (`06`), then to the schema `default`. A required string with no match gets a summary of the input. If a required argument still can't be filled, it skips that tool and logs why.
- It makes **at most two tool steps** (the best match, then the second-best if that also overlapped), then gives a final answer that templates in the tool outputs: `"Looked up customer 42 (tier: gold) — ..."`. Given the same input and tool list, it always makes the same choices.

**Handoff (`16`) combined with tools.** A handoff agent can use tools before it decides. Tool steps never route anything. Only the `final` step carries `handoffTarget`, and the existing validation (the target must match an outgoing edge label, otherwise a `PermanentFailure`) applies unchanged. This is the useful pattern: `lookup_customer` returns `tier: gold`, and the agent routes to the "VIP" branch. The mock provider matches candidates against the input *and* the tool outputs. The LLM provider adds the candidate list to the system prompt, as it already does.

### 6. Visible in the run monitor

- Each tool call is recorded as `nodeResults[].toolCalls[]` and streamed as **`agent:tool_call`** twice: once at `started`, then once more at `success` or `failed`.
- Every argument and output passes through `25`'s secret redaction before it's emitted or stored, so a connection secret echoed back by a server never reaches a log.
- The monitor shows a **nested timeline** under the agent node: `step 1 → lookup_customer({ id: 42 }) ✓ 180 ms (cached)` → `step 2 → final answer`. Each row has an expandable args/output view. Tool calls also appear in the node's log tail.
- The agent node shows a `🔧 3` chip counting its tool calls.

### 7. The bundled demo server

`server/src/mcp/demoServer.js` is a small stdio MCP server built with the same SDK. It's on the allowlist by default (`sandboxSafe`), and it exposes four tools backed by `27`'s sandbox store (`SandboxRecord { workspaceId, integration: 'agentflow-demo', collection, doc, runId }`):

| Tool | Annotations | Behaviour |
|---|---|---|
| `lookup_customer` | `readOnlyHint` | Customer by `id` or `email`. Seeds a deterministic fake customer the first time it's asked. |
| `get_order` | `readOnlyHint` | Order by `orderId`, with status, total and items |
| `search_kb` | `readOnlyHint` | Keyword search over the workspace's KB articles |
| `create_ticket` | (side effect) | Inserts a ticket and returns `{ ticketId, url }` |

**How the process knows its workspace:** the stdio process has no request context. **The pool spawns one process per connection**, and a connection belongs to exactly one workspace, so AgentFlow sets `AGENTFLOW_WORKSPACE_ID` in the child's environment for entries marked `injectWorkspaceContext`. The alternative, adding a hidden `workspaceId` argument to every call, was rejected: it pollutes tool schemas, a strict server would reject it, and a model could put a different value in it. A process boundary is a sturdier isolation line, and one process per workspace is fine at demo scale since idle ones close after 5 minutes. The `runId` for attribution goes in the request's `_meta` (`agentflow/runId`), the protocol's reserved extension field. If the SDK drops it, records are written with `runId: null` rather than failing.

## Non-goals

- **AgentFlow as an MCP server** (considered and dropped).
- MCP resources, prompts, sampling, elicitation and roots. Only tools are in scope.
- **OAuth for remote MCP servers.** Only a static header is supported. Servers that require OAuth are unsupported, and the "Test connection" error says so.
- Tenant-defined stdio servers, and editing the allowlist from the UI.
- **The Claude API's built-in MCP connector** (`mcp_servers` + an `mcp_toolset` tool, beta `mcp-client-2025-11-20`). It runs tool calls from Anthropic's side. That means it only reaches publicly reachable remote servers (no stdio, no localhost, no demo server), it can't be used by the mock provider, and it bypasses AgentFlow's queue, retries, cache, redaction and live monitor. Using it would hide exactly the orchestration layer this project exists to show.
- Streaming progress from long-running tools (`notifications/progress`) into the UI.
- Memory for agents across runs, and agents that discover or add tools at run time. The tool set is fixed when the node is designed.

## Data Model

**Connection** (`25`) with `integration: 'mcp'`:
```
config:      { transport: 'http' | 'stdio', url?: string, headerName?: string, allowlistId?: string,
               toolsSnapshot: { tools: [{ name, title, description, inputSchema, outputSchema?, annotations }],
                                fetchedAt: Date, serverInfo: { name, version } } | null }
credentials: { authHeader?: string }   // encrypted, write-only
```

**Agent node config** gains:
```
tools: [{ integration: string, action: string, connectionId: ObjectId | null }]   // max 20
allowSideEffects: boolean (default false)
```

**Run `nodeResults[]`** gains:
```
toolCalls: [{ step: number, callId: string, tool: { integration, action, connectionId, name },
              args: Mixed, status: 'success' | 'failed', output?: Mixed, error?: string,
              cached: boolean, attempts: number, sandbox: boolean, startedAt: Date, durationMs: number }]
agentSteps: number
```

## API

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/mcp/allowlist` | `connections:manage` | `[{ id, name, description }]`. Never `command`, `args` or `env`. |
| GET | `/api/workspaces/:id/connections/:cid/mcp/tools` | `connections:use` | `{ tools: [{ name, title, description, annotations, configSchema, jsonEditor, inputSchema, outputSchema? }], fetchedAt, source: 'live' \| 'cache' \| 'snapshot' }` |
| POST | `/api/workspaces/:id/connections/:cid/mcp/refresh` | `connections:use` | Runs `tools/list` again, replaces the snapshot, returns the same shape as above |

- `25`'s `POST …/connections/:cid/test` for an MCP connection runs `initialize` + `tools/list` and reports the server name, version and tool count.
- Creating, editing and deleting MCP connections uses `25`'s connection routes. Those, and `34`'s audit events, don't change.
- Node validation (`20`'s panel) resolves MCP actions from the snapshot and needs no extra endpoint.

## Socket contract

| Event | Direction | Payload |
|---|---|---|
| `agent:tool_call` | server → `run:<id>` | `{ runId, nodeId, step, callId, tool: { integration, action, name }, args, status: 'started' \| 'success' \| 'failed', output?, error?, cached?, durationMs? }`. Args and output are redacted, and output is truncated to 8 000 characters over the socket. |

Existing `node:update` and `node:log` events don't change. `node:update` additionally carries `agentSteps`.

## UI Behavior

- **Connections page** (`25`) → "Add MCP server":
  - **Remote** asks for a URL, an optional header name and an optional header value (a password field, write-only).
  - **Local** is a dropdown of allowlisted servers with their descriptions.
  - After saving, "Test connection" shows the server info and tool count.
- **Connection detail** lists the discovered tools (name, description, a "read-only" or "side effect" badge from the annotations), shows when the list was fetched and whether it came from the live server or the saved snapshot, and has a **Refresh tools** button.
- **Node palette:** an "MCP" section lists the workspace's MCP connections. Expanding one lists its tools, with search. Dropping a tool creates a pre-configured tool node.
- **Tool node config panel:** a connection picker, then the tool's generated form, plus JSON editors for complex properties with inline schema errors. A **sandbox** badge appears when the node would run in sandbox mode.
- **Agent config panel:** a "Tools" multi-picker grouped by connection or integration (20 at most, with a counter), the "Allow side-effecting tools" checkbox and its warning, and for LLM mode a note about the 8-step limit.
- **Run monitor:** the nested tool-call timeline and the `🔧 n` chip described in Goal 6.
- **Validation panel (`20`):** "Tool `X` is no longer offered by <server>" (warning), "Connection missing or deleted" (error), "Agent has side-effecting tools but side effects aren't allowed" (error).

## Edge Cases & Error Handling

- **A tool is removed from the server after a node was configured with it** → the validation panel warns once the snapshot is refreshed, and at run time the node fails with `PermanentFailure: MCP tool "X" is not offered by <server>`. For an agent, that tool is dropped from its tool list for the run, with a log line.
- **An allowlist entry is removed while connections still use it** → the connection's status becomes `error`, and calls fail permanently with `MCP server "<id>" is no longer allowlisted`.
- **The stdio process crashes mid-call** → that call fails as retryable, the pool restarts the process with backoff, and the queue retries the call.
- **A remote server redirects to a private address, or resolves to one** → `safeRequest` blocks it: the call fails permanently, and the test action reports `blocked by network policy`.
- **The server is slow** → the call is cancelled at `MCP_CALL_TIMEOUT_MS` (with `notifications/cancelled` sent), and the timeout is retryable.
- **The run is cancelled while an agent is mid-loop** → no further turns or tool calls are enqueued. In-flight calls get `notifications/cancelled`, and results that arrive after that are recorded but not fed back to the model.
- **The schema uses `$ref` or composition keywords, or is huge** → those properties fall back to the JSON editor, as described in Goal 3. It never crashes the panel.
- **Two servers expose tools with the same name** → the connection-slug prefix keeps the LLM tool names distinct, and the palette groups tools by server.
- **An argument fails validation against the tool's schema at run time** (for example a `{{input.x}}` template resolved to the wrong type) → the node fails permanently, naming the offending field, and nothing is sent to the server.
- **An LLM tool call names an unknown tool or has malformed arguments** → a `tool_result` marked `is_error: true` with the validation message. It counts against the 8 steps, and the node doesn't fail.
- **A server echoes a credential back in its output** → `25`'s redaction replaces it before the value is logged, streamed or stored.
- **Sandbox mode with no snapshot yet** (the connection was never tested) → the node fails permanently with `No tool list available offline; test the connection once with INTEGRATIONS_LIVE on`.

## Acceptance Criteria

- [ ] An allowlisted stdio server and a remote Streamable HTTP server can each be added, tested and refreshed. Their tools appear in the palette with generated forms.
- [ ] A connection can't be created with a command, args or env. The API accepts only `allowlistId` for stdio, and an unknown id returns 400.
- [ ] The spawned stdio process's environment contains only the allowlist entry's env and `PATH`. `JWT_SECRET` and `SECRETS_MASTER_KEY` are absent.
- [ ] Remote MCP traffic goes through `safeRequest`: a server URL resolving to `127.0.0.1`, `10.x` or `169.254.169.254`, or redirecting there, is blocked.
- [ ] `@modelcontextprotocol/sdk` isn't loaded in a process that never touches an MCP connection.
- [ ] An MCP Tool node runs a real `tools/call`. `structuredContent` or joined text becomes the output, and image blocks are stored as metadata only.
- [ ] `isError: true` fails the node without a retry. A killed stdio process and a timeout are retried.
- [ ] Only tools marked `readOnlyHint` get cache hits, and no cache hit crosses workspaces or connections.
- [ ] With `INTEGRATIONS_LIVE=false`, a remote MCP node returns a schema-shaped placeholder with `sandbox: true` and makes zero network requests. The demo server (`sandboxSafe`) is still called.
- [ ] A mock agent given `lookup_customer` and `search_kb` makes the same choices on repeated runs of the same input, calls the tool for real, and each call appears in `toolCalls[]`, in `agent:tool_call` and on the monitor timeline.
- [ ] With `AGENT_PROVIDER=anthropic`, an agent completes a multi-step tool loop, runs parallel `tool_use` blocks together and returns their results in one message, and stops at 8 steps.
- [ ] Four agents with tools running concurrently at `QUEUE_CONCURRENCY=4` complete. No deadlock.
- [ ] An agent without `allowSideEffects` can't be saved or run with a side-effecting tool.
- [ ] A handoff agent uses a tool and then routes on the tool's result. An unmatched target still fails as in `16`.
- [ ] Demo-server records written from two workspaces land in their own `SandboxRecord` sets, and neither can read the other's through `lookup_customer` or `search_kb`.
- [ ] Deleting an MCP connection closes its pool entry and kills its stdio process.

`npm run check:mcp` (in `server/`) covers these using the bundled demo server over stdio, plus an in-process Streamable HTTP test server. The single `anthropic`-mode criterion is a manual rehearsal, since it needs a real API key.
