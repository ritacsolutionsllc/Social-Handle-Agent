import { profileUrlFor, type AvailabilityResult, type PlatformConfig } from '@sha/core';
import type { LiveAdapterDeps } from '../types';
import { parseRetryAfter, readCapped, TimeoutError, withTimeout } from '../util';

type Extra = Partial<Omit<AvailabilityResult, 'platform' | 'handle' | 'checkedAt' | 'simulated'>>;

export function makeResult(platform: PlatformConfig, handle: string, now: Date, fields: Pick<AvailabilityResult, 'status' | 'confidence' | 'source'> & Extra, simulated = false): AvailabilityResult {
  const r: AvailabilityResult = { platform: platform.slug, handle, checkedAt: now.toISOString(), simulated, ...fields };
  if (r.status === 'taken' && !r.profileUrl) r.profileUrl = profileUrlFor(platform, handle);
  return r;
}

export const unknown = (platform: PlatformConfig, handle: string, now: Date, source: string, reason: AvailabilityResult['reason'], evidence: string) =>
  makeResult(platform, handle, now, { status: 'unknown', confidence: 'low', source, reason, evidence });

export const missingCredentials = (platform: PlatformConfig, handle: string, now: Date, source: string, names: string[]) =>
  unknown(platform, handle, now, source, 'missing_credentials', `Live check not configured: set ${names.join(', ')} on the server. No result was simulated.`);

/** Convert thrown errors into normalized results. Never includes URLs (they may carry tokens). */
export function fromError(platform: PlatformConfig, handle: string, now: Date, source: string, err: unknown): AvailabilityResult {
  const isTimeout = err instanceof TimeoutError || (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError'));
  return makeResult(platform, handle, now, {
    status: 'error',
    confidence: 'low',
    source,
    reason: isTimeout ? 'timeout' : 'upstream_error',
    error: isTimeout ? 'The platform did not respond in time.' : 'The platform request failed.',
  });
}

export function rateLimited(platform: PlatformConfig, handle: string, now: Date, source: string, res: Response): AvailabilityResult {
  const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'), now);
  return makeResult(platform, handle, now, {
    status: 'rate_limited',
    confidence: 'low',
    source,
    evidence: `HTTP ${res.status}`,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  });
}

const BOT_MARKERS = [/captcha/i, /verify you are (a )?human/i, /cf-challenge|challenge-platform/i, /unusual traffic/i, /access denied/i];

export type ProbeOutcome =
  | { kind: 'robots_disallowed' }
  | { kind: 'response'; status: number; body: string; location: string | null; res: Response };

/** Polite public-page probe: robots.txt first, no redirects followed, capped body. */
export async function probe(deps: LiveAdapterDeps, url: string, signal: AbortSignal, timeoutMs: number): Promise<ProbeOutcome> {
  if (!(await deps.robots.isAllowed(url, signal))) return { kind: 'robots_disallowed' };
  const res = await deps.fetch(url, {
    signal: withTimeout(signal, timeoutMs),
    redirect: 'manual',
    headers: { 'user-agent': deps.userAgent, accept: 'text/html', 'accept-language': 'en-US,en;q=0.8' },
  });
  const body = res.status === 200 ? await readCapped(res) : '';
  return { kind: 'response', status: res.status, body, location: res.headers.get('location'), res };
}

/** Shared handling for responses that are never definitive. Returns null if the adapter should decide. */
export function interpretNonDefinitive(platform: PlatformConfig, handle: string, now: Date, source: string, p: ProbeOutcome): AvailabilityResult | null {
  if (p.kind === 'robots_disallowed') {
    return unknown(platform, handle, now, source, 'robots_disallowed', 'robots.txt disallows automated access to this profile path; not checked.');
  }
  if (p.status === 429) return rateLimited(platform, handle, now, source, p.res);
  if (p.status >= 300 && p.status < 400) {
    const where = p.location ? safeLocation(p.location) : 'unknown location';
    return unknown(platform, handle, now, source, 'ambiguous_response', `Redirected (HTTP ${p.status}) to ${where}; a redirect or login wall is not proof of availability.`);
  }
  if (p.status === 403 || p.status === 401 || BOT_MARKERS.some((m) => m.test(p.body))) {
    return unknown(platform, handle, now, source, 'bot_protection', `Blocked by login wall or bot protection (HTTP ${p.status}).`);
  }
  if (p.status >= 500) {
    return makeResult(platform, handle, now, { status: 'error', confidence: 'low', source, reason: 'upstream_error', error: `Platform returned HTTP ${p.status}.` });
  }
  return null;
}

function safeLocation(loc: string): string {
  try {
    const u = new URL(loc, 'https://placeholder.invalid');
    return u.host === 'placeholder.invalid' ? u.pathname : `${u.host}${u.pathname}`;
  } catch {
    return 'an unparseable location';
  }
}

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
