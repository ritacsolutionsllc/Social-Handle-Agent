import { IdParamSchema } from '@sha/core';
import { route } from '@/server/http';
import { runtime } from '@/server/runtime';

export const POST = route<{ id: string }>(async ({ params, auth }) => runtime().creation.retry(auth, IdParamSchema.parse(params).id));
