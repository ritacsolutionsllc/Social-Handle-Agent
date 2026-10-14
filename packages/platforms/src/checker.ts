import type { AvailabilityResult, PlatformConfig } from '@sha/core';
import type { KeyValueCache } from './cache';
import { fromError, makeResult, unknown } from './adapters/result';
import type { AdapterRegistry } from './registry';
import { noopLogger, type Logger } from './types';
import { backoffDelay, Semaphore, sleep } from './util';

export interface CheckTask {
  platform: PlatformConfig;
  handle: string;
}

export interface CheckerDeps {
  registry: AdapterRegistry;
  cache: KeyValueCache;
  cacheTtlSeconds: number;
  concurrency: number;
  now?: () => Date;
  rng?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  logger?: Logger;
}

export interface CheckManyOptions {
  signal: AbortSignal;
  bypassCache?: boolean;
}

const CACHEABLE = new Set<AvailabilityResult['reason'] | undefined>([undefined, 'unsupported', 'missing_credentials', 'robots_disallowed', 'ambiguous_response', 'derived_unknown']);

/**
 * Orchestrates adapters: bounded global + per-platform concurrency, short-TTL
 * caching keyed by provider mode + platform + handle, and exponential backoff
 * with jitter on rate limits. Every task yields exactly one result, even on
 * cancellation or deadline (as `error/timeout`).
 */
export class AvailabilityChecker {
  private readonly global: Semaphore;
  private readonly perPlatform = new Map<string, Semaphore>();
  private readonly now: () => Date;
  private readonly rng: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly log: Logger;

  constructor(private readonly deps: CheckerDeps) {
    this.global = new Semaphore(deps.concurrency);
    this.now = deps.now ?? (() => new Date());
    this.rng = deps.rng ?? Math.random;
    this.sleep = deps.sleep ?? sleep;
    this.log = deps.logger ?? noopLogger;
  }

  get mode() {
    return this.deps.registry.mode;
  }

  cacheKey(platform: string, handle: string) {
    return `avail:${this.deps.registry.mode}:${platform}:${handle}`;
  }

  checkMany(tasks: CheckTask[], opts: CheckManyOptions): Promise<AvailabilityResult[]> {
    return Promise.all(tasks.map((t) => this.checkOne(t, opts)));
  }

  async checkOne({ platform, handle }: CheckTask, opts: CheckManyOptions): Promise<AvailabilityResult> {
    const key = this.cacheKey(platform.slug, handle);
    if (!opts.bypassCache) {
      const hit = await this.deps.cache.get(key).catch(() => null);
      if (hit) return JSON.parse(hit) as AvailabilityResult;
    }

    const adapter = this.deps.registry.get(platform.adapterKey);
    if (!adapter) {
      return unknown(platform, handle, this.now(), 'none', 'unsupported', `No ${this.mode} adapter is registered for "${platform.adapterKey}".`);
    }

    let releaseGlobal: (() => void) | undefined;
    let releasePlatform: (() => void) | undefined;
    try {
      releasePlatform = await this.platformSemaphore(platform).acquire(opts.signal);
      releaseGlobal = await this.global.acquire(opts.signal);
      const result = await this.withRetries(platform, handle, opts.signal, (signal) => adapter.check(handle, platform, { signal }));
      if (result.status === 'available' || result.status === 'taken' || (result.status === 'unknown' && CACHEABLE.has(result.reason))) {
        await this.deps.cache.set(key, JSON.stringify(result), this.deps.cacheTtlSeconds).catch(() => {});
      }
      this.log.info('availability.checked', { platform: platform.slug, mode: this.mode, status: result.status, source: result.source });
      return result;
    } catch (err) {
      this.log.warn('availability.check_failed', { platform: platform.slug, mode: this.mode, error: err instanceof Error ? err.name : 'unknown' });
      return opts.signal.aborted
        ? makeResult(platform, handle, this.now(), { status: 'error', confidence: 'low', source: 'orchestrator', reason: 'timeout', error: 'Check deadline exceeded.' }, this.mode === 'mock')
        : fromError(platform, handle, this.now(), 'orchestrator', err);
    } finally {
      releaseGlobal?.();
      releasePlatform?.();
    }
  }

  private async withRetries(platform: PlatformConfig, handle: string, signal: AbortSignal, run: (signal: AbortSignal) => Promise<AvailabilityResult>): Promise<AvailabilityResult> {
    const policy = platform.rateLimitPolicy;
    let result = await run(signal);
    for (let attempt = 0; result.status === 'rate_limited' && attempt < policy.maxRetries; attempt++) {
      const delay = Math.min(policy.maxDelayMs, result.retryAfterMs ?? backoffDelay(attempt, policy, this.rng));
      this.log.info('availability.backoff', { platform: platform.slug, attempt: attempt + 1, delayMs: delay });
      await this.sleep(delay, signal);
      result = await run(signal);
    }
    return result;
  }

  private platformSemaphore(p: PlatformConfig) {
    let s = this.perPlatform.get(p.slug);
    if (!s) {
      s = new Semaphore(p.rateLimitPolicy.maxConcurrent);
      this.perPlatform.set(p.slug, s);
    }
    return s;
  }
}
