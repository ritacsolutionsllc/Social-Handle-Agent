import { DelayedError, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { leaseExpiresAt, processCreationJob, type JobRef, type ServiceDeps } from '@sha/services';
import { CREATION_QUEUE } from './dispatchers';

/** Slack after the lease so the redelivery lands once the row is definitely stale. */
const LEASE_GRACE_MS = 5_000;

/**
 * BullMQ worker. RetryableJobError propagates so BullMQ applies its backoff;
 * the processor already moved the DB row back to `queued`.
 *
 * If the row is still `running` under another attempt's lease (a duplicate delivery, or
 * BullMQ redelivering a crashed worker's job before the lease ends), the delivery is
 * parked until the lease expires instead of completing. The later delivery then either
 * finds the job finished (skip) or recovers the stale attempt.
 */
export function startCreationWorker(deps: ServiceDeps, connection: Redis, concurrency = 4): Worker<JobRef> {
  const worker = new Worker<JobRef>(
    CREATION_QUEUE,
    async (job, token) => {
      const ref = job.data;
      if (typeof ref?.workspaceId !== 'string' || typeof ref?.jobId !== 'string') throw new Error('malformed job payload');
      const out = await processCreationJob(deps, ref, AbortSignal.timeout(60_000));
      const leaseEnd = leaseExpiresAt(out);
      if (leaseEnd !== null) {
        try {
          await job.moveToDelayed(Math.max(leaseEnd, Date.now()) + LEASE_GRACE_MS, token);
        } catch (err) {
          // Redis unavailable or lock lost: rethrow so BullMQ counts a failed attempt and retries with backoff.
          deps.logger.warn('job.defer_failed', { jobId: ref.jobId, error: err instanceof Error ? err.message : 'unknown' });
          throw err;
        }
        deps.logger.info('job.deferred_until_lease_expiry', { jobId: ref.jobId });
        throw new DelayedError();
      }
    },
    { connection, concurrency },
  );
  worker.on('failed', (job, err) => deps.logger.warn('worker.job_failed', { jobId: job?.data.jobId, attemptsMade: job?.attemptsMade, error: err.message }));
  worker.on('error', (err) => deps.logger.error('worker.error', { error: err.message }));
  return worker;
}
