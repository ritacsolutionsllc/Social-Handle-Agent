import { route } from '@/server/http';
import { clearSession } from '@/server/session';

export const POST = route(async () => {
  await clearSession();
  return { ok: true };
});
