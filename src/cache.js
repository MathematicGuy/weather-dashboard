class TTLCache {
  constructor(ttlMs = 10 * 60 * 1000, maxEntries = 100) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) {
      this.misses += 1;
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      this.misses += 1;
      return null;
    }
    this.hits += 1;
    return entry.value;
  }

  getStale(key) {
    const entry = this.map.get(key);
    return entry ? entry.value : null;
  }

  set(key, value) {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs, createdAt: Date.now() });
  }

  clear() {
    this.map.clear();
  }

  stats() {
    const entries = [...this.map.values()];
    const total = this.hits + this.misses;
    return {
      totalEntries: this.map.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? this.hits / total : 0,
      oldestEntry: entries.length ? new Date(Math.min(...entries.map((v) => v.createdAt))).toISOString() : null,
      newestEntry: entries.length ? new Date(Math.max(...entries.map((v) => v.createdAt))).toISOString() : null
    };
  }
}

module.exports = { TTLCache };
