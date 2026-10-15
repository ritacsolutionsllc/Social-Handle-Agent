import { z } from 'zod';
import { ProviderModeSchema } from './availability';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/**
 * Application settings. Every value has a safe development default so build,
 * typecheck and unit tests never need production secrets.
 */
export const AppSettingsSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.enum(['development', 'test', 'staging', 'production']).optional(),
    AVAILABILITY_PROVIDER_MODE: ProviderModeSchema.optional(),
    ACCOUNT_CREATION_ENABLED: bool.default(false),
    AUTH_MODE: z.enum(['dev', 'supabase']).default('dev'),
    QUEUE_DRIVER: z.enum(['inline', 'bullmq']).default('inline'),
    CACHE_DRIVER: z.enum(['memory', 'redis']).default('memory'),
    REDIS_URL: z.string().optional(),
    DATABASE_URL: z.string().optional(),
    SESSION_SECRET: z.string().optional(),
    CREDENTIAL_MASTER_KEY: z.string().optional(),
    SUPABASE_URL: z.url().optional(),
    SUPABASE_ANON_KEY: z.string().optional(),
    AVAILABILITY_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(3600).default(300),
    CHECK_DEADLINE_MS: z.coerce.number().int().min(1000).max(60_000).default(20_000),
    CHECK_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(8),
    /**
     * Reverse proxies in front of the app; the client IP is the Nth-from-right X-Forwarded-For entry.
     * 0 = ignore the header, which puts every caller in one IP rate-limit bucket. Must be set
     * explicitly in staging/production so that trade-off is a deliberate choice.
     */
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).optional(),
  })
  .transform((s) => {
    // APP_ENV is authoritative. If unset, NODE_ENV=production implies production (fail safe).
    const APP_ENV = s.APP_ENV ?? (s.NODE_ENV === 'production' ? 'production' : 'development');
    return {
      ...s,
      APP_ENV,
      // Mock is the default outside production; production must choose explicitly.
      AVAILABILITY_PROVIDER_MODE: s.AVAILABILITY_PROVIDER_MODE ?? (APP_ENV === 'production' ? 'live' : 'mock'),
    };
  })
  .superRefine((s, ctx) => {
    const prod = s.APP_ENV === 'production';
    // Anything shared (staging or production) needs real auth and a shared signing secret.
    const shared = prod || s.APP_ENV === 'staging';
    if (shared && s.AUTH_MODE === 'dev') ctx.addIssue({ code: 'custom', message: `AUTH_MODE=dev is not allowed in ${s.APP_ENV}` });
    if (s.AUTH_MODE === 'supabase' && (!s.SUPABASE_URL || !s.SUPABASE_ANON_KEY))
      ctx.addIssue({ code: 'custom', message: 'AUTH_MODE=supabase requires SUPABASE_URL and SUPABASE_ANON_KEY' });
    if (shared && s.SUPABASE_URL && new URL(s.SUPABASE_URL).protocol !== 'https:')
      ctx.addIssue({ code: 'custom', message: 'SUPABASE_URL must use https outside development' });
    if (prod && s.AVAILABILITY_PROVIDER_MODE === 'mock')
      ctx.addIssue({ code: 'custom', message: 'AVAILABILITY_PROVIDER_MODE=mock is not allowed in production' });
    if (shared && (!s.SESSION_SECRET || s.SESSION_SECRET.length < 32))
      ctx.addIssue({ code: 'custom', message: `SESSION_SECRET (32+ chars) is required in ${s.APP_ENV}` });
    if (shared && s.TRUSTED_PROXY_HOPS === undefined)
      ctx.addIssue({ code: 'custom', message: `TRUSTED_PROXY_HOPS must be set explicitly in ${s.APP_ENV} (0 = no proxy; all clients then share one IP rate-limit bucket)` });
    if (s.QUEUE_DRIVER === 'bullmq' && !s.REDIS_URL) ctx.addIssue({ code: 'custom', message: 'QUEUE_DRIVER=bullmq requires REDIS_URL' });
    if (s.CACHE_DRIVER === 'redis' && !s.REDIS_URL) ctx.addIssue({ code: 'custom', message: 'CACHE_DRIVER=redis requires REDIS_URL' });
  })
  .transform((s) => ({ ...s, TRUSTED_PROXY_HOPS: s.TRUSTED_PROXY_HOPS ?? 0 }));

export type AppSettings = z.infer<typeof AppSettingsSchema>;

export function loadSettings(env: Record<string, string | undefined> = process.env): AppSettings {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = AppSettingsSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`).join('; ')}`);
  }
  return parsed.data;
}

/**
 * Session signing secret. Staging and production require SESSION_SECRET (enforced above);
 * in development and test an unset secret falls back to a random per-process value, so dev
 * sessions simply end when the server restarts. No secret literal is shipped.
 */
let ephemeralSecret: string | null = null;
export function resolveSessionSecret(settings: Pick<AppSettings, 'SESSION_SECRET' | 'APP_ENV'>): string {
  if (settings.SESSION_SECRET) return settings.SESSION_SECRET;
  if (settings.APP_ENV === 'production' || settings.APP_ENV === 'staging') throw new Error(`SESSION_SECRET is required in ${settings.APP_ENV}`);
  ephemeralSecret ??= globalThis.crypto.getRandomValues(new Uint8Array(32)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
  return ephemeralSecret;
}
