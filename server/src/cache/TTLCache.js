import { stableStringify } from '../utils/stableStringify.js';

export class TTLCache {
  constructor({ defaultTtlMs = 60_000 } = {}) {
    this.defaultTtlMs = defaultTtlMs;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  clear() {
    this.store.clear();
  }
}

/**
 * Stable (sorted-key) JSON over everything that determines a tool call's result
 * (spec/25 §5). The workspace is part of it (spec/22): the cache is one
 * process-wide Map, so without it two tenants making the same call would share
 * a result — a data leak once connections carry per-tenant credentials. The
 * connection and the mode are part of it too, so a result fetched live through
 * one account is never served to a node using another account, or to the same
 * node rehearsing in sandbox. Sorted keys mean two equal configs saved in
 * different key orders still hit.
 *
 * `toolCacheKey(workspaceId, toolType, toolConfig, input)` — the phase-2
 * positional form — still works and maps onto `builtin.<toolType>`.
 */
export function toolCacheKey(parts, ...legacy) {
  if (legacy.length || parts === null || typeof parts !== 'object' || !('integration' in parts)) {
    const [toolType, toolConfig, input] = legacy;
    return toolCacheKey({ workspaceId: parts, integration: 'builtin', action: toolType, connectionId: null, params: toolConfig, input });
  }
  const { workspaceId = null, integration, action, connectionId = null, mode = null, params = null, input = null } = parts;
  return stableStringify({
    workspaceId: workspaceId === null || workspaceId === undefined ? null : String(workspaceId),
    integration,
    action,
    connectionId: connectionId === null || connectionId === undefined ? null : String(connectionId),
    mode,
    params: params ?? null,
    input: input ?? null,
  });
}

export const toolCache = new TTLCache({ defaultTtlMs: 60_000 });
