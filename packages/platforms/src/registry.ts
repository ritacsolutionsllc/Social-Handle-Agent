import type { PlatformConfig, ProviderMode } from '@sha/core';
import {
  FacebookAvailabilityAdapter,
  InstagramAvailabilityAdapter,
  LinkedInAvailabilityAdapter,
  PinterestAvailabilityAdapter,
  RedditAvailabilityAdapter,
  SnapchatAvailabilityAdapter,
  ThreadsAvailabilityAdapter,
  TikTokAvailabilityAdapter,
  XAvailabilityAdapter,
  YouTubeAvailabilityAdapter,
} from './adapters/live';
import { MockAvailabilityAdapter, type MockAdapterOptions } from './adapters/mock';
import type { AvailabilityAdapter, LiveAdapterDeps } from './types';

export interface AdapterRegistry {
  readonly mode: ProviderMode;
  get(adapterKey: string): AvailabilityAdapter | undefined;
}

/**
 * Live registry contains ONLY live adapters. There is deliberately no code path
 * from live mode to mock results: a missing adapter yields `unknown/unsupported`.
 */
export function createLiveRegistry(deps: LiveAdapterDeps, platformLookup: (slug: string) => PlatformConfig | undefined): AdapterRegistry {
  const instagram = new InstagramAvailabilityAdapter(deps);
  const adapters: AvailabilityAdapter[] = [
    new XAvailabilityAdapter(deps),
    instagram,
    new FacebookAvailabilityAdapter(deps),
    new TikTokAvailabilityAdapter(deps),
    new YouTubeAvailabilityAdapter(deps),
    new LinkedInAvailabilityAdapter(deps),
    new PinterestAvailabilityAdapter(deps),
    new RedditAvailabilityAdapter(deps),
    new SnapchatAvailabilityAdapter(deps),
    new ThreadsAvailabilityAdapter(deps, instagram, () => platformLookup('instagram')),
  ];
  const map = new Map(adapters.map((a) => [a.key, a]));
  return { mode: 'live', get: (k) => map.get(k) };
}

export function createMockRegistry(opts: MockAdapterOptions = {}): AdapterRegistry {
  const cache = new Map<string, AvailabilityAdapter>();
  return {
    mode: 'mock',
    get(k) {
      let a = cache.get(k);
      if (!a) {
        a = new MockAvailabilityAdapter(k, opts);
        cache.set(k, a);
      }
      return a;
    },
  };
}
