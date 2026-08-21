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

export function toolCacheKey(toolType, input) {
  return `${toolType}:${JSON.stringify(input ?? null)}`;
}

export const toolCache = new TTLCache({ defaultTtlMs: 60_000 });
