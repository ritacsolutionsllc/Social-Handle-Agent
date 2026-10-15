import type { Redis } from 'ioredis';

export interface KeyValueCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Atomic increment with expiry on first write. Used by rate limiting. */
  incr(key: string, ttlSeconds: number): Promise<number>;
}

export class MemoryCache implements KeyValueCache {
  private readonly store = new Map<string, { value: string; expires: number }>();
  constructor(
    private readonly maxEntries = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  async get(key: string) {
    const e = this.store.get(key);
    if (!e) return null;
    if (e.expires <= this.now()) {
      this.store.delete(key);
      return null;
    }
    return e.value;
  }

  async set(key: string, value: string, ttlSeconds: number) {
    this.put(key, value, this.now() + ttlSeconds * 1000);
  }

  /** Synchronous read-modify-write: no await between read and write, so concurrent calls cannot interleave. */
  async incr(key: string, ttlSeconds: number) {
    const now = this.now();
    const e = this.store.get(key);
    const live = e && e.expires > now ? e : null;
    const next = (live ? Number(live.value) : 0) + 1;
    this.put(key, String(next), live ? live.expires : now + ttlSeconds * 1000);
    return next;
  }

  /** Insert with capacity bound: drop expired entries first, then the oldest. */
  private put(key: string, value: string, expires: number) {
    if (!this.store.has(key) && this.store.size >= this.maxEntries) {
      const now = this.now();
      for (const [k, v] of this.store) if (v.expires <= now) this.store.delete(k);
      if (this.store.size >= this.maxEntries) {
        const oldest = this.store.keys().next().value;
        if (oldest !== undefined) this.store.delete(oldest);
      }
    }
    this.store.set(key, { value, expires });
  }
}

export class RedisCache implements KeyValueCache {
  constructor(private readonly redis: Redis, private readonly prefix = 'sha:') {}
  get(key: string) {
    return this.redis.get(this.prefix + key);
  }
  async set(key: string, value: string, ttlSeconds: number) {
    await this.redis.set(this.prefix + key, value, 'EX', Math.max(1, ttlSeconds));
  }
  async incr(key: string, ttlSeconds: number) {
    const k = this.prefix + key;
    const [[, n]] = (await this.redis.multi().incr(k).expire(k, ttlSeconds, 'NX').exec()) as [[unknown, number]];
    return n;
  }
}
