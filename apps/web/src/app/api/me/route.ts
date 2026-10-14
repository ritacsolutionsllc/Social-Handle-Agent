import { route } from '@/server/http';
import { runtime } from '@/server/runtime';

export const GET = route(async ({ session }) => {
  const s = runtime().settings;
  return {
    user: { email: session.email, role: session.role },
    settings: { availabilityMode: s.AVAILABILITY_PROVIDER_MODE, accountCreationEnabled: s.ACCOUNT_CREATION_ENABLED, appEnv: s.APP_ENV },
  };
});
