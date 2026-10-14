import { PLATFORM_CATALOG, type PlatformConfig } from '@sha/core';
import type { FetchLike, LiveAdapterDeps } from '../src';

export const platform = (slug: string): PlatformConfig => PLATFORM_CATALOG.find((p) => p.slug === slug)!;
export const NOW = new Date('2026-10-14T12:00:00Z');
export const signal = () => new AbortController().signal;

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;
export function fakeFetch(routes: Array<[RegExp, Route]>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    const r = routes.find(([re]) => re.test(url));
    if (!r) throw new Error(`unexpected fetch ${url}`);
    return r[1](url, init);
  }) as FetchLike & { calls: string[] };
  fn.calls = calls;
  return fn;
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
export const html = (body: string, status = 200, headers: Record<string, string> = {}) => new Response(status === 200 ? body : null, { status, headers });

export function deps(fetch: FetchLike, creds: Record<string, string> = {}, robotsAllowed = true): LiveAdapterDeps {
  return { fetch, credentials: (n) => creds[n], now: () => NOW, userAgent: 'SocialHandleAgent/0.1 (+test)', robots: { isAllowed: async () => robotsAllowed } };
}
