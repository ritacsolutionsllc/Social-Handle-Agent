import { IdParamSchema, RecheckRequestSchema } from '@sha/core';
import { CHECK_LIMITS, parseJson, route } from '@/server/http';
import { runtime } from '@/server/runtime';

export const POST = route<{ id: string }>(
  async ({ req, params, auth }) => {
    const { id } = IdParamSchema.parse(params);
    const { platform, handle } = await parseJson(req, RecheckRequestSchema);
    return runtime().checks.recheck(auth, id, platform, handle);
  },
  { limits: CHECK_LIMITS },
);
