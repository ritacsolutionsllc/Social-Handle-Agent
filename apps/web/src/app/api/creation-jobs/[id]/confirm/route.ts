import { IdParamSchema } from '@sha/core';
import { route } from '@/server/http';
import { runtime } from '@/server/runtime';

/** User reports manual signup is complete; the server re-verifies before marking succeeded. */
export const POST = route<{ id: string }>(async ({ params, auth }) => runtime().creation.confirmCompleted(auth, IdParamSchema.parse(params).id));
