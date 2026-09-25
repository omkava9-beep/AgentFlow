# Spec: Integration Catalogue, Sandbox Store & Safe Outbound HTTP

**Status:** Phase 3 — Tier 1
**Milestone:** M4
**Depends on:** `24-socket-auth-and-namespaced-events.md`, `25-secrets-and-connections.md`, `26-integration-framework.md`
**Revises:** `21-extended-tool-catalog.md` (`http-request` goes live; `MockRecord` becomes `SandboxRecord`; its "no outbound network call" non-goal no longer applies)

## Summary

Fills `26`'s framework with **20 integrations**. Every action works with no account through a **stateful per-workspace sandbox**: writes persist, reads return what was written, and empty stores are seeded with believable fixtures. That's what makes the sandbox feel like the real thing rather than a canned response. **Six integrations have live adapters** (Slack, Discord, GitHub, HTTP Request, Outbound Webhook, RSS). They're used by default whenever a connection has credentials (C2), and the HTTP Request tool is live even with no connection (C3). Database and Knowledge Base are real but in-process, and AI follows `AGENT_PROVIDER`.

This spec also defines the two pieces of infrastructure every live call and every inbound event goes through:

- **`safeRequest`**, the SSRF-guarded HTTP client, and the only outbound network path in the codebase;
- **provider-shaped inbound webhooks**, which turn a real Stripe or GitHub delivery into a workspace event.

## Goals

### 1. `safeRequest`: the only way out

`server/src/net/safeRequest.js`:

```
safeRequest({ url, method = 'GET', headers = {}, body, timeoutMs = 10_000, maxBytes = 1_048_576, maxRedirects = 3 })
  → { status, ok, url /* final */, headers /* lowercased, selected */, body, text, truncated, durationMs }
```

It's used by every `live()` implementation (through `ctx.http`), by connection tests, by the RSS poller, and by remote MCP (`37`). **Nothing else in the server may import `http`, `https`, `undici` or call `fetch` for outbound traffic.** `check:http` enforces this with a static scan, and `CLAUDE.md` states the rule.

**Destination checks:**

- The URL is parsed with WHATWG `URL`, which normalises decimal, octal and hex IPv4 (`http://2130706433/` becomes `127.0.0.1`). Only `http:` and `https:` are allowed, and URLs with userinfo (`user:pass@host`) are rejected.
- **IP literals are checked directly**, because Node skips `lookup` for them. Hostnames go through a **custom `lookup`** passed to `http.request`. It resolves every address (`dns.lookup(all: true)`) and rejects the request if **any** address is blocked. Because this check runs inside the socket's own lookup, the IP that was validated is the IP that gets connected to, which defeats DNS rebinding.
- **Blocked ranges:** `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16` (this includes the cloud metadata address `169.254.169.254`), `172.16.0.0/12`, `192.168.0.0/16`, `224.0.0.0/4` and above, `::`, `::1`, `fc00::/7`, `fe80::/10`, and IPv4-mapped IPv6 forms of all of these (`::ffff:127.0.0.1`).
- **Redirects** are followed manually (`maxRedirects`, default 3). Every `Location` is re-parsed and re-checked from scratch, so a public URL that redirects to `http://127.0.0.1` gets blocked. Scheme downgrades from `https` to `http` are refused.
- **`HTTP_TOOL_ALLOWED_HOSTS`** (optional, comma-separated, supports `*.example.com`) restricts *all* `safeRequest` destinations when set.
- **`HTTP_TOOL_ALLOW_PRIVATE_NETWORKS=true`** (default `false`) disables the private-range block, for local development only, for example to chain into AgentFlow's own webhook endpoint. When it's on, boot logs a warning. Both flags keep their historical `HTTP_TOOL_` names, but they apply to every `safeRequest` caller.

**Limits and hygiene:**

- `timeoutMs` covers the whole request, including redirects, and is capped at 30 s.
- The body stops being read at `maxBytes`. The response is still returned, with `truncated: true` (it's not an error).
- TLS certificate validation is always on. Proxy environment variables are ignored.
- The `User-Agent` is `AgentFlow/1.0 (+<PUBLIC_BASE_URL>)`.
- Request bodies that are objects are sent as JSON with the right `Content-Type`.
- A response with a JSON content type is parsed into `body`. Otherwise `body` is the text, capped. `text` is always the raw text.

**Errors**, and how they map onto the queue:

| Error | Retry? |
|---|---|
| `SsrfBlockedError` (blocked address, bad scheme, disallowed host) | never, it's permanent |
| DNS failure, `ECONNREFUSED`, `ECONNRESET` before the request is sent | yes, any method |
| Timeout, `5xx`, connection reset after the request is sent | only for idempotent methods (`GET`, `HEAD`, `PUT`, `DELETE`, `OPTIONS`) |
| `429` | yes, any method, honouring `Retry-After` (`26`) |
| Any other `4xx` | never, it's permanent |

This refines `26`'s blanket "`5xx` and timeouts retry" rule. Retrying a `POST` that may already have arrived could send a Slack message twice. So for `POST` and `PATCH`, a timeout or `5xx` fails the node with `Not retried: POST is not idempotent and may have been received`.

### 2. The live HTTP Request action (`http.request`)

- **Params:**
  - `url` (required)
  - `method` (select; default `GET`)
  - `headers` (`json`, optional)
  - `body` (textarea, `{{input.x}}` supported; sent as JSON when it parses as JSON, otherwise as text)
  - `timeoutMs` (number, ≤ 30000)
  - `cacheGet` (boolean, default `false`; when true, a `GET` becomes cacheable)
- **Auth:** `auth.type: 'none'`, with optional connection fields `scheme` (`bearer` / `apiKey` / `basic`), `token` (secret), `headerName` (default `X-API-Key`), `username`, `password` (secret). The credentials are added to the outgoing headers and never appear in the output (`25` redaction).
- **Output:** `{ status, ok, url, method, headers: { 'content-type', 'content-length', … }, body, truncated, durationMs }`. `ok: false` responses that aren't retried become node failures, with the status and a body excerpt in the message.
- **Sandbox** (for `connectionId: 'sandbox'` or when live mode is disabled): the phase-2 simulated response, now also recorded in `http.requests` in the sandbox store, so a Sandbox run can be inspected.

### 3. The sandbox store

`SandboxRecord` generalises `MockRecord` (`21`):

- `ctx.sandbox` is a store automatically scoped to `(workspaceId, integration)`. Collection names are namespaced `<integration>.<name>` (for example `github.issues`). Its methods:
  - `insert(collection, doc)` → doc with `id`
  - `find(collection, filter, { limit = 50, sort })`
  - `findOne`
  - `update(collection, id, patch)`
  - `remove`
  - `count`
  - `seed(collection, docs)`
- **Filters are equality-only on top-level fields.** Keys starting with `$` or containing `.` are rejected with a `PermanentFailure`, so a user-typed filter in `database.find` can't turn into a Mongo operator injection.
- **Seeding on first touch:** the first read of an empty collection in a workspace inserts that integration's fixtures, for example GitHub repo `acme/web` with three open issues, or a sheet with a header row and five rows. Reads are never empty on a fresh workspace.
- **Numbering that looks real:** GitHub and Jira issues get per-repo or per-project incrementing numbers (`#4`, `WEB-12`), and Stripe objects get `cus_…`, `in_…`, `re_…` ids.
- **Migration:** existing `MockRecord` documents move to `SandboxRecord` with `integration: 'database'` and `collection: 'database.<collectionName>'`. The migration is idempotent and runs on boot after `26`'s tool-node migration. `MockRecord` is then deleted.
- **Browsing:** each integration's detail page has a **Sandbox data** tab listing its collections and recent records, with "Reset sandbox" (`connections:manage`). You can see that the sandbox Slack message was "sent".
- **Sandbox writes never fire integration triggers.** A sandbox "create GitHub issue" doesn't emit `github.issue_opened`. That keeps a workflow from triggering itself in a loop. Triggers come only from inbound webhooks and test events (Goal 5).

### 4. The catalogue

Legend: **L** = live adapter, *s* = sandbox only. Every action also has an `outputSample` matching the sandbox output.

| Integration (`id`) | Auth | Actions → output | Triggers | Live details |
|---|---|---|---|---|
| **Slack** (`slack`) | `webhookUrl` | `post_message` {channel, text, blocks?(json)} → `{ posted, channel, ts }` **L**; `post_to_thread` {channel, threadTs, text} *s* | `message_received` | Incoming webhook URL, must be on `hooks.slack.com`. The response `ok` means success. `test()` checks the URL format and offers an explicit "Send test message". |
| **Discord** (`discord`) | `webhookUrl` | `send_message` {content, username?} → `{ sent, id, channelId }` **L**; `send_embed` {title, description, color, url?} **L** | — | `discord.com/api/webhooks/…?wait=true` returns the message. `test()` does a `GET` on the webhook URL (Discord returns webhook info). |
| Microsoft Teams (`teams`) | `webhookUrl` | `post_message` {title?, text} → `{ posted }` *s* | — | — |
| Email (`email`) | `custom` (SMTP host, port, user, password) | `send` {to, subject, body} → `{ delivered, to, messageId }` *s* | `email_received` | Sandbox writes an `OutboxMessage` (`23`, `kind: 'smtp'`) to the recipient. No real delivery (phase-3 non-goal). |
| Twilio SMS (`twilio`) | `basic` (Account SID, auth token) | `send_sms` {to, body} → `{ sid, status: 'queued' }` *s* | `sms_received` | — |
| **GitHub** (`github`) | `bearer` (PAT) | `create_issue` {repo, title, body, labels?} → `{ number, url, state }` **L**; `comment` {repo, number, body} **L**; `list_issues` {repo, state} → `{ issues[] }` **L** (cacheable); `get_repo` {repo} **L** (cacheable) | `issue_opened`, `pr_opened` | `api.github.com` only, with `Accept: application/vnd.github+json` and `X-GitHub-Api-Version: 2022-11-28`. `test()` calls `GET /user`. |
| Jira (`jira`) | `basic` (site, email, API token) | `create_ticket` {project, summary, type} → `{ key }`; `transition_ticket` {key, status} *s* | `ticket_created` | — |
| Linear (`linear`) | `apiKey` | `create_issue` {team, title, priority} → `{ identifier, url }` *s* | `issue_created` | — |
| Google Sheets (`sheets`) | `apiKey` | `append_row` {spreadsheet, sheet, values(json array)}; `read_rows` {spreadsheet, sheet, limit} (cacheable); `update_row` {spreadsheet, sheet, row, values} *s* | `row_added` | — |
| Notion (`notion`) | `bearer` | `create_page` {database, title, properties(json)}; `query_database` {database, filter(json)} *s* | — | — |
| Airtable (`airtable`) | `bearer` | `create_record` {base, table, fields(json)}; `list_records` {base, table} *s* | `record_created` | — |
| **Database** (`database`) | `none` | `insert` {collection, document(json)} → `{ inserted, id }`; `find` {collection, filter(json), limit}; `update` {collection, id, patch(json)} | — | Real, contained: the sandbox store *is* the database. No external calls. |
| Stripe (`stripe`) | `bearer` (secret key) + optional `webhookSecret` | `create_customer` {email, name}; `create_invoice` {customer, amount, currency}; `refund` {payment, amount?} *s* | `payment_succeeded`, `payment_failed` | Actions are sandbox. Inbound webhooks are real and signature-verified (Goal 5). |
| HubSpot (`hubspot`) | `bearer` | `create_contact` {email, firstName, lastName}; `update_deal_stage` {deal, stage} *s* | `contact_created` | — |
| **HTTP Request** (`http`) | `none` (optional auth) | `request`, see Goal 2 | — | **Live by default** (C3) |
| **Outbound Webhook** (`webhook`) | `none` (optional `secret` for HMAC signing) | `post` {url, payload(json)} → `{ status, ok }` **L** | — | Sends `X-AgentFlow-Signature: sha256=<hmac>` when a secret is set. Follows `POST`'s no-retry-on-timeout rule. |
| **RSS** (`rss`) | `none` | `read_feed` {url, limit} → `{ title, items[{ title, link, published, summary }] }` **L** (cacheable) | `new_item` | Poll trigger (Goal 6) |
| **AI** (`ai`) | `none` | `classify` {labels, instructions?} → `{ label, confidence }`; `extract` {fields} → `{ [field]: value }`; `summarize` {maxWords}; `draft_reply` {tone} | — | Runs through `AgentProvider` (see below) |
| Knowledge Base (`knowledge`) | `none` | `search` {query, topK} → `{ results[{ docId, title, chunk, score }] }` (cacheable) | — | Real, in process (Goal 7) |
| Built-in demo (`builtin`) | `none` | `fake-weather`, `calculator`, `fake-search`, unchanged from phase 2 | — | — |

**AI presets are not live/sandbox.** They build a preset system prompt and call `getAgentProvider().run()`, so what really runs follows `AGENT_PROVIDER`. `MockAgentProvider` gains preset-aware templated output:

- `classify` picks the label whose word appears in the input, otherwise one at random, and says which;
- `extract` pulls matching keys from an object input;
- `summarize` truncates to `maxWords`;
- `draft_reply` fills a tone template.

`LLMAgentProvider` asks for JSON. The node result's `mode` records `mock` or `llm` for these actions. This is the one exception to `26`'s two-value `mode`.

### 5. Inbound webhooks: real events from real services

Every connection whose integration declares `inbound` has an **inbound URL**:

```
POST /api/w/:slug/hooks/:integration/:inboundToken
```

- `inboundToken` is a random 24-byte token stored on the `Connection` (`25`) and regenerable. It's a capability, like `13`'s webhook token. The URL is shown on the connection, together with the provider's setup steps ("In GitHub → Settings → Webhooks, paste this URL, content type JSON").
- The handler looks up the connection by `(workspace slug, integration, inboundToken)`, returning **404** for any mismatch. It runs the manifest's optional `inbound.verify(req, connection)`, then `inbound.parse(req)`, which returns `{ triggerId, data }` or `null`.
  - **GitHub:** `X-Hub-Signature-256` HMAC over the raw body, if a webhook secret is set; `X-GitHub-Event: issues` + `action: opened` maps to `issue_opened`, and `pull_request` + `opened` to `pr_opened`.
  - **Stripe:** `Stripe-Signature` (`t=…,v1=…`, HMAC-SHA256 over `t.body`, 5-minute tolerance) when `webhookSecret` is set; `payment_intent.succeeded` / `.payment_failed` map to the two triggers.
  - **Slack:** answers the Events API `url_verification` challenge; `event_callback` + `message` maps to `message_received`.
  - **Twilio:** form-encoded `From` / `Body` map to `sms_received`.
  - **Others:** a documented generic JSON shape.
- Signature failure → **401**. An event type the manifest doesn't map → `202 { triggered: [], ignored: true }`, since providers retry on errors.
- A mapped event dispatches `<integration>.<triggerId>` through `24`'s per-workspace fan-out with `26`'s envelope (`connectionId` set, `test: false`), and returns `202 { triggered: [runId…] }`.
- The route uses `express.raw()`, so HMACs are computed over the exact bytes that arrived, which is exactly what `express.json()` would throw away.
- Real providers need a publicly reachable URL, so inbound URLs are built from `PUBLIC_BASE_URL`. For a local demo, the "Send test event" path covers it.

**Send test event:** `POST /api/integrations/:id/triggers/:triggerId/test { connectionId? }` (`workflow:run`) dispatches the trigger's `samplePayload` with `test: true`. There's a button on the integration's detail page and on a Trigger panel event card subscribed to an integration trigger. Test runs show a **TEST** badge in the run history.

### 6. RSS poll trigger

`rss.new_item` is the one poll-based trigger. A workflow subscribed to it with an RSS connection (`config: { feedUrl, pollMinutes ≥ 5 }`) gets a job in the existing in-process cron registry (`12`), keyed per connection. Each tick:

- fetches the feed through `safeRequest`;
- dedupes by item `guid` or `link` against the `rss.seen` sandbox collection;
- dispatches one event per new item. The first poll only records what it sees, so subscribing doesn't fire the whole backlog.

Pollers are re-registered on boot, the same way schedules are. Feeds are parsed with **`fast-xml-parser`**, this spec's one new dependency. It's pure JS, and preferable to regex-parsing XML.

### 7. Knowledge Base

- **Documents:** paste text or upload `.txt` / `.md` files, up to 200 KB each and 50 per workspace, on the Knowledge Base integration page (`connections:manage`).
- They're stored as `KnowledgeDoc` and split into chunks of about 500 characters along paragraph boundaries.
- **Search:** an in-process TF-IDF index **per workspace**, held in a `Map` keyed by `workspaceId`. It's built lazily on first search and dropped when a document changes. `search` returns the top-k chunks with cosine scores.
- There are no embeddings and no vector database. That's deliberate and in keeping with "no external infra". The action output shape is the same one a vector search would return, so the backend could be swapped later.

### 8. Integrations gallery

- **Nav item "Integrations"** → `/w/:slug/integrations`: cards grouped by category, with search, a *Live* badge where live-capable, and a count of this workspace's connections.
- Icons are simple monochrome glyph tiles in category colours. Official brand logos aren't bundled.
- **Detail page** `/w/:slug/integrations/:id`, with tabs:
  - **Overview:** description, actions with their output samples, triggers;
  - **Connections:** `25`'s list and form, filtered to this integration, including the inbound URL and setup steps;
  - **Sandbox data** (Goal 3);
  - **Knowledge**, for `knowledge` only.
- There are "Send test event" buttons per trigger.

## Non-goals

- OAuth, real email delivery, or any live adapter beyond the six marked **L** (and GitHub only through `api.github.com`).
- Full API coverage for any provider. Each integration offers the handful of actions a demo workflow needs.
- Sandbox writes firing triggers (loop safety; Goal 3). No `database.record_inserted` trigger for the same reason.
- Embeddings or a vector store for the Knowledge Base. File parsing beyond `.txt` and `.md`.
- Webhook delivery guarantees: no retries, no ordering, no replay of inbound events beyond what the provider itself does.
- Outbound proxies or custom CA certificates.

## Data Model

**SandboxRecord** (replaces `MockRecord`)
```
{ _id, workspaceId, integration: string, collection: string, doc: Mixed, runId: ObjectId | null, createdAt, updatedAt }
index { workspaceId: 1, collection: 1, createdAt: -1 }
```

**KnowledgeDoc** (new)
```
{ _id, workspaceId, title, text, chunks: [String], createdBy, createdAt, updatedAt }
```

**Connection**: `inboundToken` (declared in `25`).
**Run**: `input.test: boolean` inside the event envelope. Run history derives the TEST badge from it.

## API

| Method | Path | Auth | Response |
|---|---|---|---|
| POST | `/api/w/:slug/hooks/:integration/:inboundToken` | token (+ signature where configured) | `202 { triggered, ignored? }` · `401` bad signature · `404` |
| POST | `/api/connections/:id/inbound-token` | `connections:manage` | regenerate → `{ inboundUrl }` |
| POST | `/api/integrations/:id/triggers/:triggerId/test` | `workflow:run` | `{ connectionId? }` → `202 { triggered }` |
| GET | `/api/integrations/:id/sandbox?collection=&limit=` | `workflow:read` | `{ collections: [{ name, count }], records: [...] }` |
| DELETE | `/api/integrations/:id/sandbox` | `connections:manage` | `204` (reset this integration's sandbox data) |
| GET / POST / DELETE | `/api/knowledge` · `/api/knowledge/:id` | read: `workflow:read`, write: `connections:manage` | Knowledge Base documents |

## Edge Cases & Error Handling

- **Live Slack or Discord URL revoked on the provider side** → the provider returns `404` or `403`. That's a permanent failure, with a message suggesting the connection be re-created. The connection's `status` is set to `error`.
- **GitHub rate limit** (`403` with `x-ratelimit-remaining: 0`, or `429`) → treated as retryable with `Retry-After` / `x-ratelimit-reset` when the wait is ≤ 30 s. Otherwise permanent, with "rate limited until <time>".
- **A redirect chain ends at a blocked address** → `SsrfBlockedError`, naming the hop, and never retried.
- **A hostname resolves to both a public and a private address** → blocked. It's a strict any-address rule, and simpler to reason about than picking one.
- **A response over 1 MB** → truncated. `truncated: true` shows in the output and the log. JSON parsing of a truncated body is skipped, and `body` is the truncated text.
- **The same inbound event delivered twice** by the provider → two runs. Deduplication by delivery id is future work; this is noted in the run log with the provider's delivery id when one is present.
- **An RSS feed that errors** on a poll → logged on the connection (`lastError`). The poller keeps its schedule, and doesn't fire.
- **Knowledge search in an empty workspace** → `{ results: [] }`, not an error.
- **An AI preset with `AGENT_PROVIDER=anthropic` returning non-JSON** → one retry with a stricter instruction, then a permanent failure with the raw text excerpt.

## Acceptance Criteria

- [ ] **Static scan:** no server file other than `net/safeRequest.js` imports `http`/`https`/`undici` or calls `fetch` for outbound traffic.
- [ ] `safeRequest` blocks `127.0.0.1`, `10.0.0.5`, `169.254.169.254`, `[::1]`, `::ffff:127.0.0.1`, `http://2130706433/`, a hostname resolving privately, and a public URL that 302s to `http://localhost`. `HTTP_TOOL_ALLOW_PRIVATE_NETWORKS=true` allows a local test server.
- [ ] The 1 MB cap truncates, the timeout fires, `4xx` is permanent, a `GET` `503` retries, and a `POST` `503` doesn't.
- [ ] An HTTP Request node with no connection makes a real call to a local test server (dev flag on) and records `mode: 'live'`. With `connectionId: 'sandbox'` it doesn't.
- [ ] Every integration's every action runs in sandbox, and each is **stateful**: create/append/insert followed by list/read/find returns the new record in the same workspace and not in another.
- [ ] A fresh workspace's first `github.list_issues` returns seeded fixtures.
- [ ] `database.find` rejects `$`-prefixed filter keys.
- [ ] A signed GitHub `issues/opened` delivery and a signed Stripe `payment_intent.payment_failed` delivery each start subscribed workflows, and a bad signature gets a 401.
- [ ] "Send test event" starts subscribed workflows with the TEST badge, and a connection-filtered subscription ignores events for other connections.
- [ ] RSS: the first poll fires nothing, and a new item on the next poll fires exactly one run.
- [ ] Knowledge search returns the chunk containing a unique phrase from an uploaded document, and never a chunk from another workspace.
- [ ] `MockRecord` documents are migrated to `SandboxRecord`, and `database-write` workflows from phase 2 still work as `database.insert`.
- [ ] **Live smoke tests** (`npm run check:integrations:live`, skipped per integration when its env var is absent): Slack (`SLACK_TEST_WEBHOOK_URL`), Discord (`DISCORD_TEST_WEBHOOK_URL`), GitHub (`GITHUB_TEST_TOKEN` + `GITHUB_TEST_REPO`), HTTP (a public echo URL) each succeed once.

`npm run check:http` covers Goals 1–2. `npm run check:integrations` (with `INTEGRATIONS_LIVE=false`) covers Goals 3–8.
