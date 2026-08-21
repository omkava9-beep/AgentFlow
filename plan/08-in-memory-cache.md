# Plan: In-Memory Cache

**Spec:** [`spec/08-in-memory-cache.md`](../spec/08-in-memory-cache.md)
**Depends on:** `05-agent-tool-providers`

## Backend Tasks

- [ ] `cache/TTLCache.js` — `Map`-based class: `get(key)` (lazy-expiry check), `set(key, value, ttlMs)`, `constructor({ defaultTtlMs = 60_000 })`
- [ ] Export a singleton instance (`cache/index.js`)
- [ ] Cache key helper: `toolCacheKey(toolType, input) → \`${toolType}:${JSON.stringify(input)}\``
- [ ] In the execution engine (`06`), before dispatching a Tool node job to the queue: check cache; on hit, skip the queue and mark `nodeResults[i].cached = true`; on miss, run normally then `cache.set(...)` the result

## Frontend Tasks

- [ ] `components/NodeStatusBadge.jsx` (or extend existing status rendering from `09`) — show a "cached" badge/icon when a node result has `cached: true`, in both live monitor and run history views

## Verification

- [ ] Running the same workflow twice quickly shows the second run's repeated Tool calls served from cache (badge shown, near-instant)
- [ ] Waiting past the TTL causes the next identical call to miss and re-execute normally
- [ ] Cache hits bypass the queue's simulated latency/failure entirely (confirm via logs/timing)
