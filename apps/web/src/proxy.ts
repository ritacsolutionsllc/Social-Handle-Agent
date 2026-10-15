import { NextResponse } from 'next/server';

const isDev = process.env.NODE_ENV !== 'production';

/** Origin of this deployment's Supabase project, or null if unset/invalid. */
function supabaseOrigin(): string | null {
  try {
    return process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).origin : null;
  } catch {
    return null;
  }
}

/**
 * Strict CSP, built per request so connect-src names exactly this deployment's Supabase
 * origin (read at runtime; next.config headers() would freeze it at build time).
 * 'unsafe-inline' for styles is required by Next's runtime style tags; 'unsafe-eval'
 * only in dev for React Refresh.
 */
function contentSecurityPolicy(): string {
  const supabase = supabaseOrigin();
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${supabase ? ` ${supabase}` : ''}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

export function proxy() {
  const res = NextResponse.next();
  res.headers.set('Content-Security-Policy', contentSecurityPolicy());
  return res;
}

export const config = {
  // Static assets carry no CSP-relevant content.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
