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
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: this.now() + ttlSeconds * 1000 });
  }

  async incr(key: string, ttlSeconds: number) {
    const cur = await this.get(key);
    const next = (cur ? Number(cur) : 0) + 1;
    const e = this.store.get(key);
    this.store.set(key, { value: String(next), expires: e && cur ? e.expires : this.now() + ttlSeconds * 1000 });
    return next;
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
