import { describe, expect, it, vi } from 'vitest';
import type { AvailabilityResult, PlatformConfig } from '@sha/core';
import { AvailabilityChecker, createLiveRegistry, createMockRegistry, isPathAllowed, MemoryCache, MockAvailabilityAdapter, parseRobots, type AdapterRegistry, type AvailabilityAdapter } from '../src';
import { deps, fakeFetch, NOW, platform, signal } from './helpers';

describe('MockAvailabilityAdapter', () => {
  const a = new MockAvailabilityAdapter('x', { now: () => NOW });
  it('is deterministic and always flagged simulated', async () => {
    const r1 = await a.check('somebrand', platform('x'), { signal: signal() });
    const r2 = await a.check('somebrand', platform('x'), { signal: signal() });
    expect(r1).toEqual(r2);
    expect(r1).toMatchObject({ simulated: true, source: 'mock_fixture' });
  });
  it('uses fixtures', async () => {
    expect((await a.check('acmerobotics', platform('x'), { signal: signal() })).status).toBe('taken');
  });
  it('mirrors live capability: facebook/linkedin unknown, instagram never available', async () => {
    for (const h of ['acmeroboticshq', 'zzzbrand', 'anotherone', 'foobarbaz']) {
      expect((await new MockAvailabilityAdapter('facebook').check(h, platform('facebook'), { signal: signal() })).status).toBe('unknown');
      expect((await new MockAvailabilityAdapter('instagram').check(h, platform('instagram'), { signal: signal() })).status).not.toBe('available');
    }
  });
});

describe('registries', () => {
  it('live registry never returns mock adapters', () => {
    const live = createLiveRegistry(deps(fakeFetch([])), platform);
    for (const slug of ['x', 'instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'pinterest', 'reddit', 'snapchat', 'threads']) {
      const a = live.get(slug)!;
      expect(a.mode).toBe('live');
      expect(a).not.toBeInstanceOf(MockAvailabilityAdapter);
    }
    expect(live.get('myspace')).toBeUndefined();
  });
});

function fakeRegistry(fn: (handle: string, p: PlatformConfig, s: AbortSignal) => Promise<AvailabilityResult>, mode: 'mock' | 'live' = 'live'): AdapterRegistry {
  const adapter: AvailabilityAdapter = { key: 'any', mode, check: (h, p, o) => fn(h, p, o.signal) };
  return { mode, get: () => adapter };
}
const ok = (p: PlatformConfig, handle: string, status: AvailabilityResult['status'] = 'available'): AvailabilityResult => ({
  platform: p.slug, handle, status, confidence: 'high', checkedAt: NOW.toISOString(), source: 'fake', simulated: false,
});

describe('AvailabilityChecker', () => {
  const base = { cacheTtlSeconds: 300, concurrency: 3, now: () => NOW, rng: () => 0.5, sleep: async () => {} };

  it('bounds global concurrency', async () => {
    let inFlight = 0, peak = 0;
    const reg = fakeRegistry(async (h, p) => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight--; return ok(p, h); });
    const c = new AvailabilityChecker({ ...base, registry: reg, cache: new MemoryCache() });
    const tasks = ['youtube', 'reddit', 'tiktok', 'pinterest', 'facebook', 'linkedin'].flatMap((s) => ['a1', 'b2'].map((h) => ({ platform: platform(s), handle: h })));
    const out = await c.checkMany(tasks, { signal: signal() });
    expect(out).toHaveLength(12);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('caches definitive results and keys the cache by provider mode', async () => {
    const fn = vi.fn(async (h: string, p: PlatformConfig) => ok(p, h));
    const cache = new MemoryCache();
    const live = new AvailabilityChecker({ ...base, registry: fakeRegistry(fn, 'live'), cache });
    await live.checkOne({ platform: platform('reddit'), handle: 'acme' }, { signal: signal() });
    await live.checkOne({ platform: platform('reddit'), handle: 'acme' }, { signal: signal() });
    expect(fn).toHaveBeenCalledTimes(1);
    const mock = new AvailabilityChecker({ ...base, registry: fakeRegistry(fn, 'mock'), cache });
    await mock.checkOne({ platform: platform('reddit'), handle: 'acme' }, { signal: signal() });
    expect(fn).toHaveBeenCalledTimes(2);
    await live.checkOne({ platform: platform('reddit'), handle: 'acme' }, { signal: signal(), bypassCache: true });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not cache errors', async () => {
    const fn = vi.fn(async (h: string, p: PlatformConfig) => ({ ...ok(p, h, 'error') }));
    const c = new AvailabilityChecker({ ...base, registry: fakeRegistry(fn), cache: new MemoryCache() });
    await c.checkOne({ platform: platform('reddit'), handle: 'acme' }, { signal: signal() });
    await c.checkOne({ platform: platform('reddit'), handle: 'acme' }, { signal: signal() });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries rate limits with backoff up to the platform policy', async () => {
    const sleeps: number[] = [];
    let n = 0;
    const reg = fakeRegistry(async (h, p) => (++n < 3 ? { ...ok(p, h, 'rate_limited') } : ok(p, h)));
    const c = new AvailabilityChecker({ ...base, registry: reg, cache: new MemoryCache(), sleep: async (ms) => { sleeps.push(ms); } });
    const r = await c.checkOne({ platform: platform('reddit'), handle: 'acme' }, { signal: signal() });
    expect(r.status).toBe('available');
    expect(sleeps).toEqual([250, 500]); // full jitter with rng=0.5: 0.5*500, 0.5*1000
  });

  it('gives up after maxRetries and returns rate_limited', async () => {
    const reg = fakeRegistry(async (h, p) => ok(p, h, 'rate_limited'));
    const c = new AvailabilityChecker({ ...base, registry: reg, cache: new MemoryCache() });
    expect((await c.checkOne({ platform: platform('reddit'), handle: 'acme' }, { signal: signal() })).status).toBe('rate_limited');
  });

  it('turns a deadline into error/timeout instead of hanging', async () => {
    const reg = fakeRegistry((_h, _p, s) => new Promise((_r, rej) => s.addEventListener('abort', () => rej(new Error('aborted')))));
    const c = new AvailabilityChecker({ ...base, registry: reg, cache: new MemoryCache() });
    const r = await c.checkOne({ platform: platform('reddit'), handle: 'acme' }, { signal: AbortSignal.timeout(20) });
    expect(r).toMatchObject({ status: 'error', reason: 'timeout' });
  });

  it('works end-to-end with the mock registry', async () => {
    const c = new AvailabilityChecker({ ...base, registry: createMockRegistry(), cache: new MemoryCache() });
    const r = await c.checkOne({ platform: platform('x'), handle: 'acmerobotics' }, { signal: signal() });
    expect(r).toMatchObject({ status: 'taken', simulated: true });
  });
});

describe('robots.txt', () => {
  const txt = `User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: SocialHandleAgent\nDisallow: /`;
  it('applies the most specific group', () => {
    const g = parseRobots(txt);
    expect(isPathAllowed(g, 'SocialHandleAgent/0.1', '/@acme')).toBe(false);
    expect(isPathAllowed(g, 'OtherBot', '/@acme')).toBe(true);
  });
  it('longest match wins', () => {
    const g = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/ok');
    expect(isPathAllowed(g, 'x', '/private/no')).toBe(false);
    expect(isPathAllowed(g, 'x', '/private/ok/1')).toBe(true);
  });
  it('supports wildcards and end anchors', () => {
    const g = parseRobots('User-agent: *\nDisallow: /*.json$');
    expect(isPathAllowed(g, 'x', '/a/b.json')).toBe(false);
    expect(isPathAllowed(g, 'x', '/a/b.json?x')).toBe(true);
  });
});

describe('review fixes: cache, semaphore, checker, robots', () => {
  it('MemoryCache.incr is atomic under concurrency', async () => {
    const c = new MemoryCache();
    const counts = await Promise.all(Array.from({ length: 50 }, () => c.incr('k', 60)));
    expect(new Set(counts).size).toBe(50);
    expect(Math.max(...counts)).toBe(50);
  });
  it('MemoryCache stays within maxEntries for incr keys', async () => {
    const c = new MemoryCache(10);
    for (let i = 0; i < 100; i++) await c.incr(`rl:${i}`, 60);
    expect((c as unknown as { store: Map<string, unknown> }).store.size).toBeLessThanOrEqual(10);
  });
  it('Semaphore never exceeds max during release handoff', async () => {
    const { Semaphore } = await import('../src');
    const s = new Semaphore(1);
    const r1 = await s.acquire();
    const waiting = s.acquire();
    r1(); // hands the permit to the waiter
    await expect(Promise.race([s.acquire().then(() => 'stole'), new Promise((r) => setTimeout(() => r('blocked'), 20))])).resolves.toBe('blocked');
    (await waiting)();
  });
  it('Semaphore refuses an already-aborted signal even with free capacity', async () => {
    const { Semaphore } = await import('../src');
    await expect(new Semaphore(5).acquire(AbortSignal.abort())).rejects.toBeDefined();
  });
  it('a corrupt cache entry is treated as a miss', async () => {
    const cache = new MemoryCache();
    const c = new AvailabilityChecker({ registry: createMockRegistry(), cache, cacheTtlSeconds: 300, concurrency: 2 });
    await cache.set(c.cacheKey('x', 'acmerobotics'), '{not json', 60);
    expect((await c.checkOne({ platform: platform('x'), handle: 'acmerobotics' }, { signal: signal() })).status).toBe('taken');
  });
  it('does not cache missing_credentials results', async () => {
    const cache = new MemoryCache();
    const live = createLiveRegistry(deps(fakeFetch([])), platform);
    const c = new AvailabilityChecker({ registry: live, cache, cacheTtlSeconds: 300, concurrency: 2 });
    const r = await c.checkOne({ platform: platform('x'), handle: 'acmehq' }, { signal: signal() });
    expect(r.reason).toBe('missing_credentials');
    expect(await cache.get(c.cacheKey('x', 'acmehq'))).toBeNull();
  });
  it('robots: a caller abort propagates and is not cached as disallow-all', async () => {
    const { RobotsPolicy } = await import('../src');
    let calls = 0;
    const robots = new RobotsPolicy(async (_u, init) => {
      calls++;
      if (calls === 1) throw init?.signal?.reason ?? new Error('aborted');
      return new Response('User-agent: *\nAllow: /');
    }, 'test');
    const ac = new AbortController();
    ac.abort();
    await expect(robots.isAllowed('https://example.test/a', ac.signal)).rejects.toBeDefined();
    await expect(robots.isAllowed('https://example.test/a', signal())).resolves.toBe(true);
  });
  it('mock confidence mirrors live adapters (X available is medium, TikTok low)', async () => {
    expect((await new MockAvailabilityAdapter('x').check('acmeroboticshq', platform('x'), { signal: signal() })).confidence).toBe('medium');
    expect((await new MockAvailabilityAdapter('tiktok').check('acmeroboticshq', platform('tiktok'), { signal: signal() })).confidence).toBe('low');
    expect((await new MockAvailabilityAdapter('reddit').check('acmeroboticshq', platform('reddit'), { signal: signal() })).confidence).toBe('high');
  });
});
