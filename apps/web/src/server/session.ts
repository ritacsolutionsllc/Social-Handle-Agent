import 'server-only';
import { randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT, createRemoteJWKSet } from 'jose';
import { cookies } from 'next/headers';
import { DEV_SESSION_SECRET, type Role } from '@sha/core';
import { runtime } from './runtime';

export const SESSION_COOKIE = 'sha_session';
export const CSRF_COOKIE = 'sha_csrf';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface Session {
  userId: string;
  workspaceId: string;
  email: string;
  role: Role;
  csrf: string;
}

function secret(): Uint8Array {
  const s = runtime().settings.SESSION_SECRET ?? DEV_SESSION_SECRET; // dev fallback refused in production by settings
  return new TextEncoder().encode(s);
}

export async function issueSession(identity: Omit<Session, 'csrf'>): Promise<Session> {
  const csrf = randomBytes(24).toString('base64url');
  const jwt = await new SignJWT({ wid: identity.workspaceId, email: identity.email, role: identity.role, csrf })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(identity.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .setIssuer('social-handle-agent')
    .sign(secret());
  const env = runtime().settings.APP_ENV;
  const secure = env === 'production' || env === 'staging';
  const jar = await cookies();
  jar.set(SESSION_COOKIE, jwt, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: SESSION_TTL_SECONDS });
  // Readable by JS on purpose (double-submit); useless without the httpOnly session it is bound to.
  jar.set(CSRF_COOKIE, csrf, { httpOnly: false, sameSite: 'strict', secure, path: '/', maxAge: SESSION_TTL_SECONDS });
  return { ...identity, csrf };
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
}

export async function readSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: 'social-handle-agent', algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.wid !== 'string' || typeof payload.email !== 'string' || typeof payload.csrf !== 'string') return null;
    return { userId: payload.sub, workspaceId: payload.wid, email: payload.email, role: payload.role as Role, csrf: payload.csrf };
  } catch {
    return null;
  }
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/** Verify a Supabase access token (asymmetric JWT) via the project's JWKS. */
export async function verifySupabaseToken(accessToken: string): Promise<string> {
  const url = runtime().settings.SUPABASE_URL;
  if (!url) throw new Error('SUPABASE_URL is not configured');
  jwks ??= createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', url));
  const { payload } = await jwtVerify(accessToken, jwks, { issuer: `${url.replace(/\/$/, '')}/auth/v1`, audience: 'authenticated' });
  if (typeof payload.email !== 'string') throw new Error('token has no email');
  return payload.email;
}
