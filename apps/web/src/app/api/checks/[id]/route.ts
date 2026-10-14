import { IdParamSchema } from '@sha/core';
import { route } from '@/server/http';
import { runtime } from '@/server/runtime';

export const GET = route<{ id: string }>(async ({ params, auth }) => runtime().checks.getReport(auth, IdParamSchema.parse(params).id));
