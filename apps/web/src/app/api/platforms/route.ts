import { summarizePlatform } from '@sha/services';
import { route } from '@/server/http';
import { runtime } from '@/server/runtime';

export const GET = route(async () => ({ platforms: (await runtime().deps.catalog.listEnabled()).map(summarizePlatform) }));
