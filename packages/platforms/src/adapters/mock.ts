import type { AvailabilityResult, AvailabilityStatus, PlatformConfig } from '@sha/core';
import type { AvailabilityAdapter, CheckOptions } from '../types';
import { sleep } from '../util';
import { makeResult } from './result';

/**
 * Deterministic fixtures for development and tests. Every result is flagged
 * `simulated: true` and `source: "mock_fixture"`; the UI labels them as demo data.
 *
 * The mock mirrors what each LIVE strategy is able to conclude, so the demo never
 * shows a confidence the real integration could not deliver (e.g. Facebook is
 * always unknown, Instagram/Snapchat can never be "available").
 */
export const MOCK_FIXTURES: Record<string, Partial<Record<string, AvailabilityStatus>>> = {
  acmerobotics: { x: 'taken', instagram: 'taken', tiktok: 'taken', youtube: 'taken', pinterest: 'available', reddit: 'available', snapchat: 'taken' },
  acme_robotics: { instagram: 'unknown', tiktok: 'available', youtube: 'taken', pinterest: 'available', reddit: 'taken' },
  acmeroboticshq: { x: 'available', tiktok: 'available', youtube: 'available', pinterest: 'available', reddit: 'available' },
  acmeroboticsai: { x: 'available', tiktok: 'taken', youtube: 'available', pinterest: 'available', reddit: 'available' },
  takeneverywhere: { x: 'taken', instagram: 'taken', tiktok: 'taken', youtube: 'taken', pinterest: 'taken', reddit: 'taken', snapchat: 'taken' },
};

const MOCK_SOURCE = 'mock_fixture';

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export interface MockAdapterOptions {
  latencyMs?: number;
  now?: () => Date;
}

export class MockAvailabilityAdapter implements AvailabilityAdapter {
  readonly mode = 'mock' as const;
  constructor(readonly key: string, private readonly opts: MockAdapterOptions = {}) {}

  async check(handle: string, platform: PlatformConfig, { signal }: CheckOptions): Promise<AvailabilityResult> {
    if (this.opts.latencyMs) await sleep(this.opts.latencyMs, signal);
    const now = (this.opts.now ?? (() => new Date()))();
    const status = this.capability(platform, this.pick(handle, platform.derivedFrom ?? platform.slug));
    const evidence = `Simulated ${status} result from deterministic fixture. No platform was contacted.`;
    const confidence = status === 'unknown' ? 'low' : platform.availabilityStrategy === 'official_api' ? 'high' : 'medium';
    return makeResult(
      platform,
      handle,
      now,
      {
        status,
        confidence,
        source: MOCK_SOURCE,
        evidence,
        ...(status === 'unknown' ? { reason: platform.availabilityStrategy === 'manual_only' ? ('unsupported' as const) : ('ambiguous_response' as const) } : {}),
      },
      true,
    );
  }

  private pick(handle: string, slug: string): AvailabilityStatus {
    const fixture = MOCK_FIXTURES[handle]?.[slug];
    if (fixture) return fixture;
    const n = fnv1a(`${slug}:${handle}`) % 100;
    const shortPenalty = handle.length <= 5 ? 40 : 0;
    if (n < 25 + shortPenalty) return 'taken';
    if (n < 88) return 'available';
    return 'unknown';
  }

  /** Clamp to what the live strategy for this platform could actually conclude. */
  private capability(platform: PlatformConfig, status: AvailabilityStatus): AvailabilityStatus {
    switch (platform.availabilityStrategy) {
      case 'manual_only':
        return 'unknown';
      case 'derived':
        return status === 'taken' ? 'taken' : 'unknown';
      default:
        if ((platform.slug === 'instagram' || platform.slug === 'snapchat') && status === 'available') return 'unknown';
        return status;
    }
  }
}
