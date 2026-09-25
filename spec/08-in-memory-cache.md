# Spec: In-Memory Cache

**Status:** MVP
**Milestone:** M2
**Depends on:** `05-agent-tool-providers.md`

> **Revised in phase 3:** the cache key is prefixed with `workspaceId` ([`22`](22-workspaces-multitenancy.md)) and later `connectionId` (`25`), so no cache hit crosses tenants. The key becomes stable (sorted-key) JSON over `{ workspaceId, integration, action, connectionId, params, input }` — see [`25`](25-secrets-and-connections.md).

## Summary

A TTL-based in-process cache for Tool node results, so identical tool calls (same tool type + same input) within a short window return instantly instead of re-running the mocked latency/failure logic. Demonstrates the "caching" pillar of the project without needing Redis.

## Goals

- `cache.get(key)` / `cache.set(key, value, ttlMs)` — simple Map-based or `node-cache`-based store.
- Cache key derived from `(toolType, JSON.stringify(input))`.
- Default TTL (e.g. 60s), configurable per tool type if needed.
- Execution engine (`06`) checks the cache before dispatching a Tool node job to the queue (`07`); on a hit, skip the queue entirely and mark the node result with a `cached: true` flag.

## Non-goals

- Cache invalidation strategies beyond TTL expiry (no manual invalidation UI needed).
- Caching Agent node output — only Tool node calls are cached (agents are meant to represent "reasoning," which is more reasonable to always re-run; tools represent repeatable external calls).
- Shared cache across server restarts or multiple processes — in-memory, single-process only, matching the queue (`07`).

## Design

```
class TTLCache {
  constructor({ defaultTtlMs = 60_000 }) { this.store = new Map() }
  get(key) { ... }   // returns undefined if missing or expired
  set(key, value, ttlMs) { ... }
}
```

A background sweep (or lazy expiry check on `get`) removes stale entries — lazy expiry-on-read is sufficient, no need for a timer sweep at this scale.

## UI Behavior

- In the Run Monitor (`09`) and Run History (`11`) detail views, a Tool node result that was served from cache shows a small "cached" badge/icon instead of the normal execution duration.

## Edge Cases & Error Handling

- Non-deterministic tool inputs (e.g. including a timestamp) would never hit the cache — that's expected/fine, not a bug to work around.
- Cache grows unbounded only within TTL windows and process lifetime — acceptable at this scale; no eviction-by-size policy needed.

## Acceptance Criteria

- [ ] Running the same workflow twice in quick succession shows the second run's repeated Tool calls as cache hits (faster, badge shown).
- [ ] Waiting past the TTL causes the next identical call to miss the cache and re-execute normally.
- [ ] Cache hits bypass the job queue's simulated latency/failure entirely.
