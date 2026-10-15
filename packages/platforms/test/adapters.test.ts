import { describe, expect, it } from 'vitest';
import {
  FacebookAvailabilityAdapter, InstagramAvailabilityAdapter, LinkedInAvailabilityAdapter, PinterestAvailabilityAdapter, RedditAvailabilityAdapter,
  SnapchatAvailabilityAdapter, ThreadsAvailabilityAdapter, TikTokAvailabilityAdapter, XAvailabilityAdapter, YouTubeAvailabilityAdapter, MockAvailabilityAdapter,
} from '../src';
import { deps, fakeFetch, html, json, platform, signal } from './helpers';

const noFetch = fakeFetch([]);

describe('missing credentials never simulate a result', () => {
  it.each([
    ['x', () => new XAvailabilityAdapter(deps(noFetch))],
    ['instagram', () => new InstagramAvailabilityAdapter(deps(noFetch))],
    ['reddit', () => new RedditAvailabilityAdapter(deps(noFetch))],
  ])('%s → unknown/missing_credentials without network', async (slug, make) => {
    const r = await make().check('acme', platform(slug), { signal: signal() });
    expect(r).toMatchObject({ status: 'unknown', reason: 'missing_credentials', simulated: false });
    expect(r.evidence).toMatch(/No result was simulated/);
    expect(noFetch.calls).toHaveLength(0);
  });
});

describe('manual-only platforms', () => {
  it.each([
    ['facebook', new FacebookAvailabilityAdapter(deps(noFetch))],
    ['linkedin', new LinkedInAvailabilityAdapter(deps(noFetch))],
  ])('%s is always unknown/unsupported', async (slug, a) => {
    expect(await a.check('acme', platform(slug), { signal: signal() })).toMatchObject({ status: 'unknown', reason: 'unsupported', confidence: 'low' });
  });
});

describe('XAvailabilityAdapter', () => {
  const creds = { X_BEARER_TOKEN: 't0k' };
  it('maps an existing user to taken/high with profile URL and sends bearer auth', async () => {
    let auth = '';
    const f = fakeFetch([[/api\.x\.com/, (_u, init) => { auth = new Headers(init?.headers).get('authorization')!; return json({ data: { id: '1' } }); }]]);
    const r = await new XAvailabilityAdapter(deps(f, creds)).check('acmehq', platform('x'), { signal: signal() });
    expect(r).toMatchObject({ status: 'taken', confidence: 'high', profileUrl: 'https://x.com/acmehq', source: 'x_api_v2_user_lookup' });
    expect(auth).toBe('Bearer t0k');
  });
  it('maps not-found to available with only MEDIUM confidence', async () => {
    const f = fakeFetch([[/api\.x\.com/, () => json({ errors: [{ title: 'Not Found Error' }] })]]);
    const r = await new XAvailabilityAdapter(deps(f, creds)).check('acmehq', platform('x'), { signal: signal() });
    expect(r).toMatchObject({ status: 'available', confidence: 'medium' });
    expect(r.evidence).toMatch(/not guaranteed/);
  });
  it('reports rate limits with retry-after', async () => {
    const f = fakeFetch([[/api\.x\.com/, () => json({}, 429, { 'retry-after': '3' })]]);
    expect(await new XAvailabilityAdapter(deps(f, creds)).check('acmehq', platform('x'), { signal: signal() })).toMatchObject({ status: 'rate_limited', retryAfterMs: 3000 });
  });
  it('does not leak tokens in errors', async () => {
    const f = fakeFetch([[/api\.x\.com/, () => { throw new Error('connect ECONNREFUSED https://api.x.com?token=t0k'); }]]);
    const r = await new XAvailabilityAdapter(deps(f, creds)).check('acmehq', platform('x'), { signal: signal() });
    expect(r.status).toBe('error');
    expect(JSON.stringify(r)).not.toContain('t0k');
  });
});

describe('InstagramAvailabilityAdapter', () => {
  const creds = { META_GRAPH_ACCESS_TOKEN: 'tok', META_IG_BUSINESS_ACCOUNT_ID: '123' };
  it('confirms taken for business accounts', async () => {
    const f = fakeFetch([[/graph\.facebook\.com/, () => json({ business_discovery: { username: 'acme' } })]]);
    expect(await new InstagramAvailabilityAdapter(deps(f, creds)).check('acme', platform('instagram'), { signal: signal() })).toMatchObject({ status: 'taken', confidence: 'high' });
  });
  it('never reports available when not found', async () => {
    const f = fakeFetch([[/graph\.facebook\.com/, () => json({ error: { code: 110 } }, 400)]]);
    const r = await new InstagramAvailabilityAdapter(deps(f, creds)).check('acme', platform('instagram'), { signal: signal() });
    expect(r.status).toBe('unknown');
  });
});

describe('YouTubeAvailabilityAdapter', () => {
  it('uses the Data API when a key is configured', async () => {
    const f = fakeFetch([[/googleapis\.com\/youtube\/v3\/channels\?part=id&forHandle=%40acme/, () => json({ items: [{ id: 'UC1' }] })]]);
    expect(await new YouTubeAvailabilityAdapter(deps(f, { YOUTUBE_API_KEY: 'k' })).check('acme', platform('youtube'), { signal: signal() })).toMatchObject({ status: 'taken', confidence: 'high', source: 'youtube_data_api_v3' });
  });
  it('API empty → available/medium (never high)', async () => {
    const f = fakeFetch([[/googleapis/, () => json({ pageInfo: {} })]]);
    expect(await new YouTubeAvailabilityAdapter(deps(f, { YOUTUBE_API_KEY: 'k' })).check('acme', platform('youtube'), { signal: signal() })).toMatchObject({ status: 'available', confidence: 'medium' });
  });
  it('quota errors become rate_limited', async () => {
    const f = fakeFetch([[/googleapis/, () => json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403)]]);
    expect((await new YouTubeAvailabilityAdapter(deps(f, { YOUTUBE_API_KEY: 'k' })).check('acme', platform('youtube'), { signal: signal() })).status).toBe('rate_limited');
  });
  it('probe fallback: 200 → taken/medium, 404 → available/low', async () => {
    const taken = fakeFetch([[/youtube\.com\/@acme/, () => html('<link rel="canonical" href="https://www.youtube.com/channel/UCabcdefghijklmnop">')]]);
    expect(await new YouTubeAvailabilityAdapter(deps(taken)).check('acme', platform('youtube'), { signal: signal() })).toMatchObject({ status: 'taken', confidence: 'medium', source: 'http_profile_probe' });
    const free = fakeFetch([[/youtube\.com\/@acme/, () => html('', 404)]]);
    expect(await new YouTubeAvailabilityAdapter(deps(free)).check('acme', platform('youtube'), { signal: signal() })).toMatchObject({ status: 'available', confidence: 'low' });
  });
  it('matches the page\'s own handle metadata, case-insensitively', async () => {
    const f = fakeFetch([[/youtube\.com/, () => html('<script>{"canonicalBaseUrl":"/@Acme.Co"}</script>')]]);
    expect(await new YouTubeAvailabilityAdapter(deps(f)).check('acme.co', platform('youtube'), { signal: signal() })).toMatchObject({ status: 'taken' });
  });
  it('an embedded channelId of some other channel is not proof the handle is taken', async () => {
    const body = '<script>{"channelId":"UCabcdefghijklmnop","canonicalBaseUrl":"/@someoneelse"}</script>';
    const f = fakeFetch([[/youtube\.com/, () => html(body)]]);
    expect(await new YouTubeAvailabilityAdapter(deps(f)).check('acme', platform('youtube'), { signal: signal() })).toMatchObject({ status: 'unknown', reason: 'ambiguous_response' });
  });
  it('a bare HTTP 200 without channel markers is unknown, not taken', async () => {
    const f = fakeFetch([[/youtube\.com/, () => html('<html>Before you continue to YouTube</html>')]]);
    expect(await new YouTubeAvailabilityAdapter(deps(f)).check('acme', platform('youtube'), { signal: signal() })).toMatchObject({ status: 'unknown', reason: 'ambiguous_response' });
  });
  it('a redirect (consent/login wall) is never treated as available', async () => {
    const f = fakeFetch([[/youtube\.com/, () => html('', 302, { location: 'https://consent.youtube.com/m?continue=secret' })]]);
    const r = await new YouTubeAvailabilityAdapter(deps(f)).check('acme', platform('youtube'), { signal: signal() });
    expect(r).toMatchObject({ status: 'unknown', reason: 'ambiguous_response' });
    expect(r.evidence).not.toContain('secret');
  });
  it('respects robots.txt', async () => {
    const r = await new YouTubeAvailabilityAdapter(deps(noFetch, {}, false)).check('acme', platform('youtube'), { signal: signal() });
    expect(r).toMatchObject({ status: 'unknown', reason: 'robots_disallowed' });
  });
});

describe('probe adapters', () => {
  it('TikTok: uniqueId marker → taken; 10221 → available/low; captcha → unknown', async () => {
    const t = fakeFetch([[/tiktok/, () => html('{"uniqueId":"acme","nickname":"A"}')]]);
    expect((await new TikTokAvailabilityAdapter(deps(t)).check('acme', platform('tiktok'), { signal: signal() })).status).toBe('taken');
    const a = fakeFetch([[/tiktok/, () => html('{"statusCode":10221}')]]);
    expect(await new TikTokAvailabilityAdapter(deps(a)).check('acme', platform('tiktok'), { signal: signal() })).toMatchObject({ status: 'available', confidence: 'low' });
    const c = fakeFetch([[/tiktok/, () => html('<div>Please complete the captcha</div>')]]);
    expect(await new TikTokAvailabilityAdapter(deps(c)).check('acme', platform('tiktok'), { signal: signal() })).toMatchObject({ status: 'unknown', reason: 'bot_protection' });
  });
  it('TikTok: a bare 404 is not treated as available', async () => {
    const f = fakeFetch([[/tiktok/, () => html('', 404)]]);
    expect((await new TikTokAvailabilityAdapter(deps(f)).check('acme', platform('tiktok'), { signal: signal() })).status).toBe('unknown');
  });
  it('Pinterest: 404 → available/low', async () => {
    const f = fakeFetch([[/pinterest/, () => html('', 404)]]);
    expect(await new PinterestAvailabilityAdapter(deps(f)).check('acme', platform('pinterest'), { signal: signal() })).toMatchObject({ status: 'available', confidence: 'low' });
  });
  it('Snapchat never concludes available', async () => {
    const f = fakeFetch([[/snapchat/, () => html('', 404)]]);
    expect((await new SnapchatAvailabilityAdapter(deps(f)).check('acme', platform('snapchat'), { signal: signal() })).status).toBe('unknown');
  });
});

describe('RedditAvailabilityAdapter', () => {
  const creds = { REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 's', REDDIT_USER_AGENT: 'test:sha:0.1 (by /u/x)' };
  it('a throttled token request becomes rate_limited (normal backoff path)', async () => {
    const f = fakeFetch([[/access_token/, () => json({}, 429, { 'retry-after': '2' })]]);
    expect(await new RedditAvailabilityAdapter(deps(f, creds)).check('free', platform('reddit'), { signal: signal() })).toMatchObject({ status: 'rate_limited', retryAfterMs: 2000 });
  });
  it('fetches an app token once and maps true/false', async () => {
    const f = fakeFetch([
      [/access_token/, () => json({ access_token: 'abc', expires_in: 3600 })],
      [/username_available\?user=free/, () => json(true)],
      [/username_available\?user=used/, () => json(false)],
    ]);
    const a = new RedditAvailabilityAdapter(deps(f, creds));
    expect(await a.check('free', platform('reddit'), { signal: signal() })).toMatchObject({ status: 'available', confidence: 'high' });
    expect(await a.check('used', platform('reddit'), { signal: signal() })).toMatchObject({ status: 'taken', profileUrl: 'https://www.reddit.com/user/used' });
    expect(f.calls.filter((c) => c.includes('access_token'))).toHaveLength(1);
  });
});

describe('ThreadsAvailabilityAdapter (derived)', () => {
  it('is taken when Instagram is taken, otherwise unknown', async () => {
    const ig = new MockAvailabilityAdapter('instagram');
    const a = new ThreadsAvailabilityAdapter(deps(noFetch), ig, () => platform('instagram'));
    expect((await a.check('acmerobotics', platform('threads'), { signal: signal() })).status).toBe('taken');
    expect(await a.check('acmeroboticshq', platform('threads'), { signal: signal() })).toMatchObject({ status: 'unknown', reason: 'derived_unknown' });
  });
});
