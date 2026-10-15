import type { AvailabilityResult, PlatformConfig } from '@sha/core';
import type { AvailabilityAdapter, CheckOptions, LiveAdapterDeps } from '../types';
import { withTimeout } from '../util';
import { escapeRegex, fromError, interpretNonDefinitive, makeResult, missingCredentials, probe, rateLimited, unknownResult } from './result';

/**
 * Live adapters. Each documents the ENTITY it checks and the METHOD it uses.
 * None of them ever returns simulated data: when a check cannot be performed
 * they return `unknown` with an explicit reason.
 */
abstract class LiveAdapter implements AvailabilityAdapter {
  readonly mode = 'live' as const;
  abstract readonly key: string;
  protected abstract readonly source: string;
  constructor(protected readonly deps: LiveAdapterDeps) {}

  async check(handle: string, platform: PlatformConfig, opts: CheckOptions): Promise<AvailabilityResult> {
    try {
      return await this.run(handle, platform, opts);
    } catch (err) {
      if (opts.signal.aborted) throw err; // caller cancelled; let the orchestrator decide
      return fromError(platform, handle, this.deps.now(), this.source, err);
    }
  }

  protected abstract run(handle: string, platform: PlatformConfig, opts: CheckOptions): Promise<AvailabilityResult>;
  protected get now() {
    return this.deps.now();
  }
}

/** Entity: X user account. Method: API v2 user lookup by username (bearer token). */
export class XAvailabilityAdapter extends LiveAdapter {
  readonly key = 'x';
  protected readonly source = 'x_api_v2_user_lookup';
  protected async run(handle: string, p: PlatformConfig, { signal }: CheckOptions) {
    const token = this.deps.credentials('X_BEARER_TOKEN');
    if (!token) return missingCredentials(p, handle, this.now, this.source, ['X_BEARER_TOKEN']);
    const res = await this.deps.fetch(`https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}`, {
      signal: withTimeout(signal, p.rateLimitPolicy.timeoutMs),
      headers: { authorization: `Bearer ${token}`, 'user-agent': this.deps.userAgent },
    });
    if (res.status === 429) return rateLimited(p, handle, this.now, this.source, res);
    if (res.status === 401 || res.status === 403) {
      return makeResult(p, handle, this.now, { status: 'error', confidence: 'low', source: this.source, reason: 'upstream_error', error: 'X API rejected the configured credentials or tier.' });
    }
    const body = (await res.json().catch(() => ({}))) as { data?: { id?: string }; errors?: Array<{ title?: string }> };
    if (res.ok && body.data?.id) return makeResult(p, handle, this.now, { status: 'taken', confidence: 'high', source: this.source, evidence: 'API returned an existing user.' });
    if (res.status === 404 || body.errors?.some((e) => /not found/i.test(e.title ?? ''))) {
      return makeResult(p, handle, this.now, {
        status: 'available',
        confidence: 'medium',
        source: this.source,
        evidence: 'API reports no active user. Suspended, deactivated and reserved names look identical, so registration is not guaranteed.',
      });
    }
    return unknownResult(p, handle, this.now, this.source, 'ambiguous_response', `Unexpected API response (HTTP ${res.status}).`);
  }
}

/**
 * Entity: Instagram account. Method: Graph API Business Discovery.
 * Can only see Business/Creator accounts → may confirm "taken", never "available".
 */
export class InstagramAvailabilityAdapter extends LiveAdapter {
  readonly key = 'instagram';
  protected readonly source = 'meta_graph_business_discovery';
  protected async run(handle: string, p: PlatformConfig, { signal }: CheckOptions) {
    const token = this.deps.credentials('META_GRAPH_ACCESS_TOKEN');
    const igId = this.deps.credentials('META_IG_BUSINESS_ACCOUNT_ID');
    if (!token || !igId) return missingCredentials(p, handle, this.now, this.source, ['META_GRAPH_ACCESS_TOKEN', 'META_IG_BUSINESS_ACCOUNT_ID']);
    const version = this.deps.credentials('META_GRAPH_API_VERSION') ?? 'v23.0';
    const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(igId)}`);
    url.searchParams.set('fields', `business_discovery.username(${handle}){username}`);
    const res = await this.deps.fetch(url.toString(), {
      signal: withTimeout(signal, p.rateLimitPolicy.timeoutMs),
      headers: { authorization: `Bearer ${token}`, 'user-agent': this.deps.userAgent },
    });
    if (res.status === 429) return rateLimited(p, handle, this.now, this.source, res);
    const body = (await res.json().catch(() => ({}))) as { business_discovery?: { username?: string }; error?: { code?: number } };
    if (res.ok && body.business_discovery?.username) {
      return makeResult(p, handle, this.now, { status: 'taken', confidence: 'high', source: this.source, evidence: 'A Business/Creator account uses this username.' });
    }
    if (body.error?.code === 4 || body.error?.code === 17 || body.error?.code === 32) return rateLimited(p, handle, this.now, this.source, res);
    return unknownResult(p, handle, this.now, this.source, 'ambiguous_response', 'No Business/Creator account found. Personal accounts are invisible to this API, so availability cannot be confirmed.');
  }
}

/** Entity: Facebook Page username. No permissible automated check exists. */
export class FacebookAvailabilityAdapter extends LiveAdapter {
  readonly key = 'facebook';
  protected readonly source = 'manual_only';
  protected async run(handle: string, p: PlatformConfig) {
    return unknownResult(p, handle, this.now, this.source, 'unsupported', 'Meta exposes no username availability API and prohibits automated collection. Check while creating the Page.');
  }
}

/** Entity: LinkedIn Company Page URL slug. No permissible automated check exists. */
export class LinkedInAvailabilityAdapter extends LiveAdapter {
  readonly key = 'linkedin';
  protected readonly source = 'manual_only';
  protected async run(handle: string, p: PlatformConfig) {
    return unknownResult(p, handle, this.now, this.source, 'unsupported', 'LinkedIn exposes no URL availability API and prohibits scraping. The Page setup form validates the URL.');
  }
}

/** Entity: TikTok user account. Method: robots-gated public profile probe. */
export class TikTokAvailabilityAdapter extends LiveAdapter {
  readonly key = 'tiktok';
  protected readonly source = 'http_profile_probe';
  protected async run(handle: string, p: PlatformConfig, { signal }: CheckOptions) {
    const out = await probe(this.deps, `https://www.tiktok.com/@${encodeURIComponent(handle)}`, signal, p.rateLimitPolicy.timeoutMs);
    const nd = interpretNonDefinitive(p, handle, this.now, this.source, out);
    if (nd || out.kind !== 'response') return nd!;
    if (new RegExp(`"uniqueId"\\s*:\\s*"${escapeRegex(handle)}"`, 'i').test(out.body)) {
      return makeResult(p, handle, this.now, { status: 'taken', confidence: 'medium', source: this.source, evidence: 'Profile page embeds a user with this uniqueId.' });
    }
    if (/"statusCode"\s*:\s*10221/.test(out.body)) {
      return makeResult(p, handle, this.now, {
        status: 'available',
        confidence: 'low',
        source: this.source,
        evidence: 'Profile page reports "user not found" (10221). Banned or reserved names can still be unclaimable.',
      });
    }
    return unknownResult(p, handle, this.now, this.source, 'ambiguous_response', `Profile page (HTTP ${out.status}) had no recognised markers.`);
  }
}

/**
 * Entity: YouTube channel @handle (not the Google account).
 * Method: Data API v3 channels?forHandle (preferred) or robots-gated /@handle probe.
 */
export class YouTubeAvailabilityAdapter extends LiveAdapter {
  readonly key = 'youtube';
  protected source = 'youtube_data_api_v3';
  protected async run(handle: string, p: PlatformConfig, { signal }: CheckOptions) {
    const key = this.deps.credentials('YOUTUBE_API_KEY');
    return key ? this.viaApi(handle, p, signal, key) : this.viaProbe(handle, p, signal);
  }

  private async viaApi(handle: string, p: PlatformConfig, signal: AbortSignal, key: string) {
    const source = 'youtube_data_api_v3';
    const url = new URL('https://www.googleapis.com/youtube/v3/channels');
    url.searchParams.set('part', 'id');
    url.searchParams.set('forHandle', `@${handle}`);
    url.searchParams.set('key', key);
    const res = await this.deps.fetch(url.toString(), { signal: withTimeout(signal, p.rateLimitPolicy.timeoutMs), headers: { 'user-agent': this.deps.userAgent } });
    if (res.status === 429) return rateLimited(p, handle, this.now, source, res);
    const body = (await res.json().catch(() => ({}))) as { items?: unknown[]; error?: { errors?: Array<{ reason?: string }> } };
    if (res.status === 403 && body.error?.errors?.some((e) => /quota|rateLimit/i.test(e.reason ?? ''))) return rateLimited(p, handle, this.now, source, res);
    if (!res.ok) return makeResult(p, handle, this.now, { status: 'error', confidence: 'low', source, reason: 'upstream_error', error: `YouTube API returned HTTP ${res.status}.` });
    if ((body.items?.length ?? 0) > 0) return makeResult(p, handle, this.now, { status: 'taken', confidence: 'high', source, evidence: 'API returned a channel for this handle.' });
    return makeResult(p, handle, this.now, {
      status: 'available',
      confidence: 'medium',
      source,
      evidence: 'API returned no channel. Terminated, reserved or recently released handles may still be unclaimable.',
    });
  }

  private async viaProbe(handle: string, p: PlatformConfig, signal: AbortSignal) {
    const source = 'http_profile_probe';
    const out = await probe(this.deps, `https://www.youtube.com/@${encodeURIComponent(handle)}`, signal, p.rateLimitPolicy.timeoutMs);
    const nd = interpretNonDefinitive(p, handle, this.now, source, out);
    if (nd || out.kind !== 'response') return nd!;
    if (out.status === 200) {
      // Only markers describing the page itself count: an embedded channelId may belong to another channel.
      const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const ownCanonical = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/UC[\w-]{10,}"/.test(out.body);
      const ownHandle = new RegExp(`"canonicalBaseUrl"\\s*:\\s*"\\/@${escaped}"`, 'i').test(out.body);
      return ownCanonical || ownHandle
        ? makeResult(p, handle, this.now, { status: 'taken', confidence: 'medium', source, evidence: 'Public channel page for this handle exists (HTTP 200, canonical channel URL).' })
        : unknownResult(p, handle, this.now, source, 'ambiguous_response', 'HTTP 200 without channel markers (consent, login or error page); not proof of a channel.');
    }
    if (out.status === 404) {
      return makeResult(p, handle, this.now, {
        status: 'available',
        confidence: 'low',
        source,
        evidence: 'No public channel page (HTTP 404). Set YOUTUBE_API_KEY for a stronger check; a missing page does not prove the handle is claimable.',
      });
    }
    return unknownResult(p, handle, this.now, source, 'ambiguous_response', `Unexpected HTTP ${out.status}.`);
  }
}

/** Entity: Pinterest account. Method: robots-gated public profile probe. */
export class PinterestAvailabilityAdapter extends LiveAdapter {
  readonly key = 'pinterest';
  protected readonly source = 'http_profile_probe';
  protected async run(handle: string, p: PlatformConfig, { signal }: CheckOptions) {
    const out = await probe(this.deps, `https://www.pinterest.com/${encodeURIComponent(handle)}/`, signal, p.rateLimitPolicy.timeoutMs);
    const nd = interpretNonDefinitive(p, handle, this.now, this.source, out);
    if (nd || out.kind !== 'response') return nd!;
    if (out.status === 200 && new RegExp(`"username"\\s*:\\s*"${escapeRegex(handle)}"`, 'i').test(out.body)) {
      return makeResult(p, handle, this.now, { status: 'taken', confidence: 'medium', source: this.source, evidence: 'Profile page embeds this username.' });
    }
    if (out.status === 404) {
      return makeResult(p, handle, this.now, { status: 'available', confidence: 'low', source: this.source, evidence: 'Profile page returned HTTP 404; not proof the username is registrable.' });
    }
    return unknownResult(p, handle, this.now, this.source, 'ambiguous_response', `Profile page (HTTP ${out.status}) had no recognised markers.`);
  }
}

/** Entity: Reddit user account. Method: official /api/username_available with app-only OAuth. */
export class RedditAvailabilityAdapter extends LiveAdapter {
  readonly key = 'reddit';
  protected readonly source = 'reddit_api_username_available';
  private token: { value: string; expires: number } | null = null;

  protected async run(handle: string, p: PlatformConfig, { signal }: CheckOptions) {
    const id = this.deps.credentials('REDDIT_CLIENT_ID');
    const secret = this.deps.credentials('REDDIT_CLIENT_SECRET');
    const ua = this.deps.credentials('REDDIT_USER_AGENT');
    if (!id || !secret || !ua) return missingCredentials(p, handle, this.now, this.source, ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_USER_AGENT']);
    const token = await this.getToken(id, secret, ua, signal, p.rateLimitPolicy.timeoutMs);
    if (token instanceof Response) return rateLimited(p, handle, this.now, this.source, token);
    if (!token) return makeResult(p, handle, this.now, { status: 'error', confidence: 'low', source: this.source, reason: 'upstream_error', error: 'Reddit OAuth token request failed.' });
    const res = await this.deps.fetch(`https://oauth.reddit.com/api/username_available?user=${encodeURIComponent(handle)}`, {
      signal: withTimeout(signal, p.rateLimitPolicy.timeoutMs),
      headers: { authorization: `Bearer ${token}`, 'user-agent': ua },
    });
    if (res.status === 429) return rateLimited(p, handle, this.now, this.source, res);
    if (res.status === 401) this.token = null;
    if (!res.ok) return makeResult(p, handle, this.now, { status: 'error', confidence: 'low', source: this.source, reason: 'upstream_error', error: `Reddit API returned HTTP ${res.status}.` });
    const body: unknown = await res.json().catch(() => null);
    if (body === true) return makeResult(p, handle, this.now, { status: 'available', confidence: 'high', source: this.source, evidence: 'Reddit API reports the username is available.' });
    if (body === false) return makeResult(p, handle, this.now, { status: 'taken', confidence: 'high', source: this.source, evidence: 'Reddit API reports the username is not available.' });
    return unknownResult(p, handle, this.now, this.source, 'ambiguous_response', 'Unexpected API body.');
  }

  /** Returns the token, the 429 response when throttled, or null on other failures. */
  private async getToken(id: string, secret: string, ua: string, signal: AbortSignal, timeoutMs: number): Promise<string | Response | null> {
    if (this.token && this.token.expires > this.now.getTime() + 60_000) return this.token.value;
    const res = await this.deps.fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      signal: withTimeout(signal, timeoutMs),
      headers: {
        authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': ua,
      },
      body: 'grant_type=client_credentials',
    });
    if (res.status === 429) return res;
    if (!res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!body.access_token) return null;
    this.token = { value: body.access_token, expires: this.now.getTime() + (body.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }
}

/** Entity: Snapchat account. Method: robots-gated /add/ probe. Never concludes "available". */
export class SnapchatAvailabilityAdapter extends LiveAdapter {
  readonly key = 'snapchat';
  protected readonly source = 'http_profile_probe';
  protected async run(handle: string, p: PlatformConfig, { signal }: CheckOptions) {
    const out = await probe(this.deps, `https://www.snapchat.com/add/${encodeURIComponent(handle)}`, signal, p.rateLimitPolicy.timeoutMs);
    const nd = interpretNonDefinitive(p, handle, this.now, this.source, out);
    if (nd || out.kind !== 'response') return nd!;
    if (out.status === 200 && new RegExp(`"username"\\s*:\\s*"${escapeRegex(handle)}"`, 'i').test(out.body)) {
      return makeResult(p, handle, this.now, { status: 'taken', confidence: 'medium', source: this.source, evidence: 'Public profile page exists.' });
    }
    return unknownResult(p, handle, this.now, this.source, 'ambiguous_response', 'No public profile found. Private accounts are not visible, so availability cannot be confirmed.');
  }
}

/**
 * Entity: Threads profile, whose handle IS the linked Instagram username.
 * Method: derived from the Instagram adapter.
 */
export class ThreadsAvailabilityAdapter extends LiveAdapter {
  readonly key = 'threads';
  protected readonly source = 'derived_from_instagram';
  constructor(deps: LiveAdapterDeps, private readonly instagram: AvailabilityAdapter, private readonly instagramConfig: () => PlatformConfig | undefined) {
    super(deps);
  }
  protected async run(handle: string, p: PlatformConfig, opts: CheckOptions) {
    const ig = this.instagramConfig();
    if (!ig) return unknownResult(p, handle, this.now, this.source, 'derived_unknown', 'Instagram platform config missing; cannot derive.');
    const r = await this.instagram.check(handle, ig, opts);
    if (r.status === 'taken') {
      return makeResult(p, handle, this.now, { status: 'taken', confidence: 'medium', source: this.source, evidence: 'The Instagram username is taken, so this Threads handle belongs to that account.' });
    }
    return unknownResult(p, handle, this.now, this.source, 'derived_unknown', `Follows Instagram (${r.status}). Claim the Instagram username first; Threads inherits it.`);
  }
}
