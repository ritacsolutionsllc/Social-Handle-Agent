import { CreationPlanRequestSchema } from '@sha/core';
import { parseJson, route } from '@/server/http';
import { runtime } from '@/server/runtime';

/** Read-only plan preview; available even when ACCOUNT_CREATION_ENABLED=false. */
export const POST = route(async ({ req, auth }) => runtime().creation.previewPlan(auth, await parseJson(req, CreationPlanRequestSchema)));
