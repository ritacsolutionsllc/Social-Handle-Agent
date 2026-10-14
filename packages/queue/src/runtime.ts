import { Redis } from 'ioredis';
import { loadSettings, PLATFORM_CATALOG, type AppSettings } from '@sha/core';
import { createDb, createPlatformCatalog, createUnitOfWork, createUserProvisioner, type DbHandle } from '@sha/db';
import {
  AvailabilityChecker,
  createLiveRegistry,
  createMockRegistry,
  MemoryCache,
  RedisCache,
  RobotsPolicy,
  type AdapterRegistry,
  type KeyValueCache,
} from '@sha/platforms';
import { CheckService, createLogger, CreationService, GuidedManualCreationAdapter, processCreationJob, type JobDispatcher, type ServiceDeps } from '@sha/services';
import { BullMqDispatcher, InlineDispatcher } from './dispatchers';

export const USER_AGENT = 'SocialHandleAgent/0.1 (+availability checker; respects robots.txt)';
const MAX_JOB_ATTEMPTS = 3;

/**
 * Composition root shared by the web app and the worker. This is the only
 * place that decides mock vs live, inline vs BullMQ, memory vs Redis.
 */
export interface Runtime {
  settings: AppSettings;
  deps: ServiceDeps;
  checks: CheckService;
  creation: CreationService;
  provisioner: ReturnType<typeof createUserProvisioner>;
  cache: KeyValueCache;
  redis: Redis | null;
  db: DbHandle;
  close(): Promise<void>;
}

export function createRuntime(env: Record<string, string | undefined> = process.env): Runtime {
  const settings = loadSettings(env);
  if (!settings.DATABASE_URL) throw new Error('DATABASE_URL is required to start the app (see .env.example)');
  const logger = createLogger({ service: 'social-handle-agent', appEnv: settings.APP_ENV });

  const db = createDb(settings.DATABASE_URL);
  const needsRedis = settings.CACHE_DRIVER === 'redis' || settings.QUEUE_DRIVER === 'bullmq';
  const redis = needsRedis ? new Redis(settings.REDIS_URL!, { maxRetriesPerRequest: null }) : null;
  const cache: KeyValueCache = settings.CACHE_DRIVER === 'redis' ? new RedisCache(redis!) : new MemoryCache();
  const catalog = createPlatformCatalog(db.db);

  // Separate registries; there is no fallback from live to mock anywhere.
  let platformsSnapshot = [...PLATFORM_CATALOG];
  void catalog.listEnabled().then((p) => (platformsSnapshot = p)).catch(() => {});
  const registry: AdapterRegistry =
    settings.AVAILABILITY_PROVIDER_MODE === 'live'
      ? createLiveRegistry(
          { fetch: (u, i) => fetch(u, i), credentials: (n) => env[n] || undefined, now: () => new Date(), userAgent: USER_AGENT, robots: new RobotsPolicy((u, i) => fetch(u, i), USER_AGENT) },
          (slug) => platformsSnapshot.find((p) => p.slug === slug),
        )
      : createMockRegistry({ latencyMs: settings.APP_ENV === 'test' ? 0 : 120 });

  const checker = new AvailabilityChecker({
    registry,
    cache,
    cacheTtlSeconds: settings.AVAILABILITY_CACHE_TTL_SECONDS,
    concurrency: settings.CHECK_CONCURRENCY,
    logger,
  });

  let dispatcher: JobDispatcher;
  let inline: InlineDispatcher | null = null;
  if (settings.QUEUE_DRIVER === 'bullmq') {
    dispatcher = new BullMqDispatcher(redis!, MAX_JOB_ATTEMPTS);
  } else {
    inline = new InlineDispatcher(logger, MAX_JOB_ATTEMPTS);
    dispatcher = inline;
  }

  const deps: ServiceDeps = {
    uow: createUnitOfWork(db.db),
    catalog,
    checker,
    settings,
    dispatcher,
    creationAdapters: { guided_manual: new GuidedManualCreationAdapter() },
    logger,
    maxJobAttempts: MAX_JOB_ATTEMPTS,
  };
  inline?.bind((ref) => processCreationJob(deps, ref));

  logger.info('runtime.started', {
    availabilityMode: settings.AVAILABILITY_PROVIDER_MODE,
    accountCreationEnabled: settings.ACCOUNT_CREATION_ENABLED,
    queue: settings.QUEUE_DRIVER,
    cache: settings.CACHE_DRIVER,
  });

  return {
    settings,
    deps,
    checks: new CheckService(deps),
    creation: new CreationService(deps),
    provisioner: createUserProvisioner(db.db),
    cache,
    redis,
    db,
    async close() {
      if (dispatcher instanceof BullMqDispatcher) await dispatcher.close();
      await inline?.drain();
      await redis?.quit();
      await db.close();
    },
  };
}
