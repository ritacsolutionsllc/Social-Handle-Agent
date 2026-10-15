import { CreationJobsRequestSchema } from '@sha/core';
import { CREATION_LIMITS, parseJson, route } from '@/server/http';
import { runtime } from '@/server/runtime';

export const GET = route(async ({ auth }) => ({ jobs: await runtime().creation.listJobs(auth) }));

/** Server-enforced: rejected with 403 feature_disabled when ACCOUNT_CREATION_ENABLED=false. */
export const POST = route(async ({ req, auth }) => ({ jobs: await runtime().creation.createJobs(auth, await parseJson(req, CreationJobsRequestSchema)) }), { limits: CREATION_LIMITS });
