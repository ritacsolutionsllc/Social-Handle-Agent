import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { processCreationJob, type JobRef, type ServiceDeps } from '@sha/services';
import { CREATION_QUEUE } from './dispatchers';

/**
 * BullMQ worker. RetryableJobError propagates so BullMQ applies its backoff;
 * the processor already moved the DB row back to `queued`.
 */
export function startCreationWorker(deps: ServiceDeps, connection: Redis, concurrency = 4): Worker<JobRef> {
  const worker = new Worker<JobRef>(
    CREATION_QUEUE,
    async (job) => {
      const ref = job.data;
      if (typeof ref?.workspaceId !== 'string' || typeof ref?.jobId !== 'string') throw new Error('malformed job payload');
      await processCreationJob(deps, ref, AbortSignal.timeout(60_000));
    },
    { connection, concurrency },
  );
  worker.on('failed', (job, err) => deps.logger.warn('worker.job_failed', { jobId: job?.data.jobId, attemptsMade: job?.attemptsMade, error: err.message }));
  worker.on('error', (err) => deps.logger.error('worker.error', { error: err.message }));
  return worker;
}
