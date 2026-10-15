import { describe, expect, it } from 'vitest';
import { MemoryCache, ResilientRateCounter, type KeyValueCache } from '../src';

const failing: KeyValueCache = {
  get: async () => { throw new Error('redis down'); },
  set: async () => { throw new Error('redis down'); },
  incr: async () => { throw new Error('ECONNREFUSED'); },
};

describe('ResilientRateCounter', () => {
  it('uses the primary store when healthy', async () => {
    const primary = new MemoryCache();
    const c = new ResilientRateCounter(primary);
    expect(await c.hit('k', 60)).toBe(1);
    expect(await c.hit('k', 60)).toBe(2);
    expect(await primary.get('k')).toBe('2');
  });

  it('falls back to in-memory counting when the primary store fails, so requests are still limited', async () => {
    const warnings: string[] = [];
    const logger = { info() {}, warn: (m: string) => void warnings.push(m), error() {} };
    const c = new ResilientRateCounter(failing, new MemoryCache(), logger, () => 0);
    await expect(c.hit('k', 60)).resolves.toBe(1);
    await expect(c.hit('k', 60)).resolves.toBe(2);
    await expect(c.hit('k', 60)).resolves.toBe(3);
    expect(warnings).toEqual(['ratelimit.store_unavailable']); // logged once per window, not per request
  });
});

describe('ResilientRateCounter with a hanging store', () => {
  it('falls back after the deadline instead of hanging the request', async () => {
    const hanging: KeyValueCache = { get: () => new Promise(() => {}), set: () => new Promise(() => {}), incr: () => new Promise(() => {}) };
    const c = new ResilientRateCounter(hanging, new MemoryCache(), undefined, Date.now, 20);
    const started = Date.now();
    await expect(c.hit('k', 60)).resolves.toBe(1);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
