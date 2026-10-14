import { CheckRequestSchema } from '@sha/core';
import { CHECK_LIMITS, parseJson, route } from '@/server/http';
import { runtime } from '@/server/runtime';

export const POST = route(async ({ req, auth }) => runtime().checks.runCheck(auth, await parseJson(req, CheckRequestSchema)), { limits: CHECK_LIMITS });
