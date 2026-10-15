import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { DomainError, type AuthContext } from '@sha/core';
import { ResilientRateCounter } from '@sha/platforms';
import { runtime } from './runtime';
import { readSession, type Session } from './session';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
  requestId: string;
}

type Limit = { name: string; max: number; windowSeconds: number; by: 'ip' | 'user' | 'workspace' };

const DEFAULT_LIMITS: Limit[] = [{ name: 'api', max: 240, windowSeconds: 60, by: 'ip' }];
export const CHECK_LIMITS: Limit[] = [
  { name: 'check', max: 20, windowSeconds: 60, by: 'user' },
  { name: 'check', max: 60, windowSeconds: 60, by: 'workspace' },
  { name: 'check', max: 40, windowSeconds: 60, by: 'ip' },
];
export const AUTH_LIMITS: Limit[] = [{ name: 'auth', max: 10, windowSeconds: 60, by: 'ip' }];

export interface HandlerCtx<P> {
  req: NextRequest;
  params: P;
  requestId: string;
  ip: string;
  auth: AuthContext;
  session: Session;
}

interface Options {
  auth?: boolean;
  limits?: Limit[];
}

function clientIp(req: NextRequest): string {
  // Behind a trusted proxy (Vercel/Fly/nginx) the left-most X-Forwarded-For is the client.
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
}

function json(body: unknown, status: number, requestId: string, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store', 'x-request-id': requestId, ...extra } });
}

export function errorResponse(err: unknown, requestId: string): NextResponse {
  if (err instanceof DomainError) {
    const body: ApiErrorBody = { error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) }, requestId };
    return json(body, err.status, requestId, err.code === 'rate_limited' ? { 'retry-after': String((err.details as { retryAfter?: number })?.retryAfter ?? 60) } : {});
  }
  if (err instanceof z.ZodError) {
    const body: ApiErrorBody = {
      error: { code: 'validation_error', message: 'The request is invalid.', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      requestId,
    };
    return json(body, 400, requestId);
  }
  runtime().deps.logger.error('request.unhandled', { requestId, error: err instanceof Error ? `${err.name}: ${err.message}` : 'unknown' });
  return json({ error: { code: 'internal_error', message: 'Something went wrong. Reference the request ID if you contact support.' }, requestId } satisfies ApiErrorBody, 500, requestId);
}

/** CSRF: state-changing requests need same-origin + header matching the session-bound token. */
function assertCsrf(req: NextRequest, session: Session | null) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') throw new DomainError('csrf_failed', 'Cross-site request blocked.', 403);
  if (origin && host && new URL(origin).host !== host) throw new DomainError('csrf_failed', 'Cross-origin request blocked.', 403);
  if (session && req.headers.get('x-csrf-token') !== session.csrf) throw new DomainError('csrf_failed', 'Missing or invalid CSRF token. Reload the page.', 403);
}

// One counter per process: shared store (Redis when configured), in-memory fallback if it is down.
const g = globalThis as unknown as { __shaRateCounter?: ResilientRateCounter };
function rateCounter(): ResilientRateCounter {
  const rt = runtime();
  g.__shaRateCounter ??= new ResilientRateCounter(rt.cache, undefined, rt.deps.logger);
  return g.__shaRateCounter;
}

async function enforceLimits(limits: Limit[], ip: string, session: Session | null) {
  const counter = rateCounter();
  for (const l of limits) {
    const subject = l.by === 'ip' ? ip : l.by === 'user' ? session?.userId : session?.workspaceId;
    if (!subject) continue;
    const window = Math.floor(Date.now() / 1000 / l.windowSeconds);
    const n = await counter.hit(`rl:${l.name}:${l.by}:${subject}:${window}`, l.windowSeconds);
    if (n > l.max) throw new DomainError('rate_limited', `Too many requests. Try again in a minute.`, 429, { retryAfter: l.windowSeconds, scope: l.by });
  }
}

export async function parseJson<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > 16_384) throw new DomainError('validation_error', 'Request body too large.', 413);
  const body: unknown = await req.json().catch(() => {
    throw new DomainError('validation_error', 'Body must be valid JSON.', 400);
  });
  return schema.parse(body);
}

/** Wrap a route handler with request IDs, auth, CSRF, rate limiting and typed errors. */
export function route<P = Record<string, never>>(fn: (c: HandlerCtx<P>) => Promise<unknown>, opts: Options = {}) {
  return async (req: NextRequest, ctx: { params: Promise<P> }) => {
    const requestId = req.headers.get('x-request-id')?.slice(0, 64) || randomUUID();
    const ip = clientIp(req);
    try {
      const session = await readSession();
      const needsAuth = opts.auth !== false;
      if (needsAuth && !session) throw new DomainError('unauthorized', 'Sign in to continue.', 401);
      if (req.method !== 'GET' && req.method !== 'HEAD') assertCsrf(req, needsAuth ? session : null);
      await enforceLimits([...DEFAULT_LIMITS, ...(opts.limits ?? [])], ip, session);
      const auth: AuthContext = session
        ? { userId: session.userId, workspaceId: session.workspaceId, email: session.email, role: session.role, requestId, ip }
        : ({ requestId, ip } as AuthContext);
      const result = await fn({ req, params: (await ctx.params) ?? ({} as P), requestId, ip, auth, session: session! });
      return result instanceof NextResponse ? result : json(result ?? { ok: true }, 200, requestId);
    } catch (err) {
      return errorResponse(err, requestId);
    }
  };
}
