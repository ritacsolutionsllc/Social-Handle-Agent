import { MemoryCache, type KeyValueCache } from './cache';
import { noopLogger, type Logger } from './types';

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`rate-limit store did not answer within ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Fixed-window counter that degrades instead of failing: when the shared store
 * (Redis) is unavailable, it counts in a per-process memory store so requests
 * keep flowing and are still limited per instance. Outages are logged, at most
 * once per window, so they are visible without flooding logs.
 */
export class ResilientRateCounter {
  private lastWarnedWindow = -1;

  constructor(
    private readonly primary: KeyValueCache,
    private readonly fallback: KeyValueCache = new MemoryCache(),
    private readonly logger: Logger = noopLogger,
    private readonly now: () => number = Date.now,
    /** Upper bound on waiting for the shared store before falling back. */
    private readonly timeoutMs = 300,
  ) {}

  /** Increment `key` within its window and return the new count. Never rejects for store failures. */
  async hit(key: string, windowSeconds: number): Promise<number> {
    try {
      return await withDeadline(this.primary.incr(key, windowSeconds), this.timeoutMs);
    } catch (err) {
      const window = Math.floor(this.now() / 1000 / windowSeconds);
      if (window !== this.lastWarnedWindow) {
        this.lastWarnedWindow = window;
        this.logger.warn('ratelimit.store_unavailable', { fallback: 'memory', error: err instanceof Error ? err.message : 'unknown' });
      }
      return this.fallback.incr(key, windowSeconds);
    }
  }
}
