import { SuggestionsRequestSchema } from '@sha/core';
import { parseJson, route } from '@/server/http';
import { runtime } from '@/server/runtime';

export const POST = route(async ({ req }) => {
  const { input, requestedHandle } = await parseJson(req, SuggestionsRequestSchema);
  return runtime().checks.suggestions(input, requestedHandle);
});
