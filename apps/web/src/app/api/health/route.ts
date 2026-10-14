import { sql } from 'drizzle-orm';
import { route } from '@/server/http';
import { runtime } from '@/server/runtime';

export const GET = route(
  async () => {
    const rt = runtime();
    await rt.db.db.execute(sql`select 1`);
    return { ok: true, availabilityMode: rt.settings.AVAILABILITY_PROVIDER_MODE, accountCreationEnabled: rt.settings.ACCOUNT_CREATION_ENABLED };
  },
  { auth: false },
);
