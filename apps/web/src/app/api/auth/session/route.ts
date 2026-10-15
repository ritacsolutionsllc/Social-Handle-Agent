import { errors } from 'jose';
import { DomainError, SupabaseSessionSchema } from '@sha/core';
import { AUTH_LIMITS, parseJson, route } from '@/server/http';
import { runtime } from '@/server/runtime';
import { issueSession, verifySupabaseToken } from '@/server/session';

/** Exchange a Supabase access token (verified via JWKS) for an app session cookie. */
export const POST = route(
  async ({ req, requestId }) => {
    const rt = runtime();
    if (rt.settings.AUTH_MODE !== 'supabase') throw new DomainError('forbidden', 'Supabase login is not enabled.', 403);
    const { accessToken } = await parseJson(req, SupabaseSessionSchema);
    const email = await verifySupabaseToken(accessToken).catch((err: unknown) => {
      // Token problems are the user's (401); JWKS outages or misconfiguration stay 5xx.
      // ALG_NOT_ALLOWED and JWKS_NO_MATCHING_KEY describe the token (bad alg / unknown kid);
      // JWKS fetch failures and timeouts are ours and stay 5xx.
      const tokenProblem =
        err instanceof errors.JOSEError && (/^ERR_(JWT|JWS)_/.test(err.code) || err.code === 'ERR_JOSE_ALG_NOT_ALLOWED' || err.code === 'ERR_JWKS_NO_MATCHING_KEY');
      if (tokenProblem || (err instanceof Error && err.message === 'token has no email')) {
        throw new DomainError('unauthorized', 'Invalid or expired sign-in token.', 401);
      }
      throw err;
    });
    const identity = await rt.provisioner.provision(email);
    const s = await issueSession({ ...identity, email: email.toLowerCase() });
    await rt.deps.uow.run(s.workspaceId, (r) => r.audit.record({ actorUserId: s.userId, action: 'auth.login', entityType: 'user', entityId: s.userId, metadata: { method: 'supabase', requestId } }));
    return { user: { email: s.email, role: s.role } };
  },
  { auth: false, limits: AUTH_LIMITS },
);
