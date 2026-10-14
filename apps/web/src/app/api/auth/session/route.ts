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
    const email = await verifySupabaseToken(accessToken).catch(() => {
      throw new DomainError('unauthorized', 'Invalid or expired sign-in token.', 401);
    });
    const identity = await rt.provisioner.provision(email);
    const s = await issueSession({ ...identity, email: email.toLowerCase() });
    await rt.deps.uow.run(s.workspaceId, (r) => r.audit.record({ actorUserId: s.userId, action: 'auth.login', entityType: 'user', entityId: s.userId, metadata: { method: 'supabase', requestId } }));
    return { user: { email: s.email, role: s.role } };
  },
  { auth: false, limits: AUTH_LIMITS },
);
