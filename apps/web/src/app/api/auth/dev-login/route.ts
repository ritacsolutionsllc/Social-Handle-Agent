import { DevLoginSchema, DomainError } from '@sha/core';
import { AUTH_LIMITS, parseJson, route } from '@/server/http';
import { runtime } from '@/server/runtime';
import { issueSession } from '@/server/session';

/** Email-only login for local development. Refused unless AUTH_MODE=dev (which production settings forbid). */
export const POST = route(
  async ({ req, requestId }) => {
    const rt = runtime();
    if (rt.settings.AUTH_MODE !== 'dev') throw new DomainError('forbidden', 'Development login is disabled.', 403);
    const { email } = await parseJson(req, DevLoginSchema);
    const identity = await rt.provisioner.provision(email);
    const s = await issueSession({ ...identity, email: email.toLowerCase() });
    await rt.deps.uow.run(s.workspaceId, (r) => r.audit.record({ actorUserId: s.userId, action: 'auth.login', entityType: 'user', entityId: s.userId, metadata: { method: 'dev', requestId } }));
    return { user: { email: s.email, role: s.role } };
  },
  { auth: false, limits: AUTH_LIMITS },
);
