import { existsSync } from 'node:fs';
import { createRuntime } from './runtime';
import { startCreationWorker } from './worker';

// Standalone worker process: `npm run worker` (requires QUEUE_DRIVER=bullmq + REDIS_URL).
if (existsSync('.env')) process.loadEnvFile('.env');
const rt = createRuntime();
if (rt.settings.QUEUE_DRIVER !== 'bullmq' || !rt.redis) {
  console.error('The standalone worker requires QUEUE_DRIVER=bullmq and REDIS_URL. With QUEUE_DRIVER=inline, jobs run inside the web process.');
  await rt.close();
  process.exit(1);
}
const worker = startCreationWorker(rt.deps, rt.redis);
rt.deps.logger.info('worker.started', { queue: 'account-creation', accountCreationEnabled: rt.settings.ACCOUNT_CREATION_ENABLED });

const shutdown = async (signal: string) => {
  rt.deps.logger.info('worker.stopping', { signal });
  let code = 0;
  try {
    await worker.close();
    await rt.close();
  } catch (err) {
    code = 1;
    rt.deps.logger.error('worker.shutdown_failed', { error: err instanceof Error ? err.message : 'unknown' });
  } finally {
    process.exit(code);
  }
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
