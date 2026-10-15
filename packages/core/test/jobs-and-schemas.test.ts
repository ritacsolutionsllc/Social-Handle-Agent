import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, CheckRequestSchema, CreationJobsRequestSchema, loadSettings, PlatformConfigSchema, PLATFORM_CATALOG } from '../src';

describe('job state machine', () => {
  it('allows the happy path', () => {
    expect(canTransition('queued', 'running')).toBe(true);
    expect(canTransition('running', 'awaiting_verification')).toBe(true);
    expect(canTransition('awaiting_verification', 'succeeded')).toBe(true);
  });
  it('rejects illegal transitions', () => {
    expect(canTransition('succeeded', 'queued')).toBe(false);
    expect(canTransition('queued', 'succeeded')).toBe(false);
    expect(() => assertTransition('cancelled', 'running')).toThrow(/Cannot move/);
  });
  it('allows retry of failed and cancelled jobs', () => {
    expect(canTransition('failed', 'queued')).toBe(true);
    expect(canTransition('cancelled', 'queued')).toBe(true);
  });
});

describe('API schemas', () => {
  it('accepts a valid check request and defaults includeAlternatives', () => {
    expect(CheckRequestSchema.parse({ input: 'Acme Robotics', requestedHandle: 'acmerobotics' }).includeAlternatives).toBe(true);
  });
  it('rejects empty input, control characters and bad handles', () => {
    expect(CheckRequestSchema.safeParse({ input: '' }).success).toBe(false);
    expect(CheckRequestSchema.safeParse({ input: 'a\u0000b' }).success).toBe(false);
    expect(CheckRequestSchema.safeParse({ input: 'Acme', requestedHandle: 'acme robotics' }).success).toBe(false);
    expect(CheckRequestSchema.safeParse({ input: 'Acme', platforms: ['X; drop'] }).success).toBe(false);
  });
  const base = { checkId: '7b1f8a32-6c1e-4c62-9a35-2f3d9a7e8b10', handle: 'acmehq', platforms: ['x', 'reddit'] };
  it('requires explicit confirmation of every platform and acknowledgement', () => {
    expect(CreationJobsRequestSchema.safeParse({ ...base, confirmedPlatforms: ['x', 'reddit'], acknowledgedTerms: true }).success).toBe(true);
    expect(CreationJobsRequestSchema.safeParse({ ...base, confirmedPlatforms: ['x'], acknowledgedTerms: true }).success).toBe(false);
    expect(CreationJobsRequestSchema.safeParse({ ...base, confirmedPlatforms: ['x', 'reddit'], acknowledgedTerms: false }).success).toBe(false);
  });
});

describe('platform catalog', () => {
  it('contains 10 valid, uniquely-slugged platforms', () => {
    expect(PLATFORM_CATALOG).toHaveLength(10);
    for (const p of PLATFORM_CATALOG) expect(PlatformConfigSchema.safeParse(p).success).toBe(true);
    expect(new Set(PLATFORM_CATALOG.map((p) => p.slug)).size).toBe(10);
  });
  it('never promises automated signup', () => {
    expect(PLATFORM_CATALOG.every((p) => p.creationStrategy === 'guided_manual')).toBe(true);
  });
});

describe('settings', () => {
  it('defaults to mock provider and creation disabled in development', () => {
    const s = loadSettings({ NODE_ENV: 'development', APP_ENV: 'development' });
    expect(s.AVAILABILITY_PROVIDER_MODE).toBe('mock');
    expect(s.ACCOUNT_CREATION_ENABLED).toBe(false);
  });
  it('parses ACCOUNT_CREATION_ENABLED strictly', () => {
    expect(loadSettings({ ACCOUNT_CREATION_ENABLED: 'true' }).ACCOUNT_CREATION_ENABLED).toBe(true);
    expect(() => loadSettings({ ACCOUNT_CREATION_ENABLED: 'yes' })).toThrow(/Invalid configuration/);
  });
  it('refuses unsafe production configuration', () => {
    expect(() => loadSettings({ APP_ENV: 'production', AUTH_MODE: 'dev' })).toThrow(/AUTH_MODE=dev/);
    // NODE_ENV=production without APP_ENV is treated as production (fail safe)
    expect(() => loadSettings({ NODE_ENV: 'production' })).toThrow(/AUTH_MODE=dev/);
    // An explicit non-production APP_ENV (e.g. E2E against `next start`) is allowed
    expect(loadSettings({ NODE_ENV: 'production', APP_ENV: 'test' }).AVAILABILITY_PROVIDER_MODE).toBe('mock');
    expect(() => loadSettings({ APP_ENV: 'production', AUTH_MODE: 'supabase', AVAILABILITY_PROVIDER_MODE: 'mock', SESSION_SECRET: 'x'.repeat(40) })).toThrow(/mock is not allowed/);
  });
});

describe('resolveSessionSecret', () => {
  it('uses SESSION_SECRET when set, a stable random value in dev, and throws in production', async () => {
    const { resolveSessionSecret } = await import('../src');
    expect(resolveSessionSecret({ SESSION_SECRET: 'x'.repeat(40), APP_ENV: 'development' })).toBe('x'.repeat(40));
    const a = resolveSessionSecret({ SESSION_SECRET: undefined, APP_ENV: 'development' });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(resolveSessionSecret({ SESSION_SECRET: undefined, APP_ENV: 'test' })).toBe(a);
    expect(() => resolveSessionSecret({ SESSION_SECRET: undefined, APP_ENV: 'production' })).toThrow(/required/);
  });
});

describe('settings hardening', () => {
  const ok = { SESSION_SECRET: 'x'.repeat(40), AUTH_MODE: 'supabase', SUPABASE_URL: 'https://p.supabase.co', SUPABASE_ANON_KEY: 'k' };
  it('rejects dev auth and missing secrets in staging', () => {
    expect(() => loadSettings({ APP_ENV: 'staging', AUTH_MODE: 'dev', SESSION_SECRET: 'x'.repeat(40) })).toThrow(/AUTH_MODE=dev is not allowed in staging/);
    expect(() => loadSettings({ ...ok, APP_ENV: 'staging', SESSION_SECRET: undefined })).toThrow(/SESSION_SECRET/);
  });
  it('requires complete https Supabase config for supabase auth', () => {
    expect(() => loadSettings({ AUTH_MODE: 'supabase' })).toThrow(/requires SUPABASE_URL and SUPABASE_ANON_KEY/);
    expect(() => loadSettings({ ...ok, APP_ENV: 'production', AVAILABILITY_PROVIDER_MODE: 'live', SUPABASE_URL: 'http://p.supabase.co' })).toThrow(/https/);
    expect(loadSettings({ ...ok, APP_ENV: 'production', AVAILABILITY_PROVIDER_MODE: 'live' }).AUTH_MODE).toBe('supabase');
  });
  it('accepts every generated candidate length in API handles', () => {
    expect(CheckRequestSchema.safeParse({ input: 'a', requestedHandle: 'a'.repeat(108) }).success).toBe(true);
  });
});
