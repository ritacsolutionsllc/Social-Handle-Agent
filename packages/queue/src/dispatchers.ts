import { Queue, type ConnectionOptions } from 'bullmq';
import type { Logger } from '@sha/platforms';
import { RetryableJobError, type JobDispatcher, type JobRef } from '@sha/services';

export const CREATION_QUEUE = 'account-creation';

/**
 * Durable dispatcher. The DB row is the source of truth; the BullMQ job only
 * carries the reference. jobId = DB job id dedupes concurrent enqueues.
 */
export class BullMqDispatcher implements JobDispatcher {
  private readonly queue: Queue<JobRef>;
  constructor(connection: ConnectionOptions, private readonly attempts: number) {
    this.queue = new Queue<JobRef>(CREATION_QUEUE, { connection });
  }
  async enqueue(ref: JobRef) {
    await this.queue.add('create', ref, {
      jobId: ref.jobId,
      attempts: this.attempts,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: true,
      removeOnFail: true, // history lives in account_creation_job_events
    });
  }
  close() {
    return this.queue.close();
  }
}

/**
 * In-process dispatcher for local development without Redis. Not durable:
 * a process restart drops in-flight work (jobs stay `queued` and can be retried).
 */
export class InlineDispatcher implements JobDispatcher {
  private process: ((ref: JobRef) => Promise<unknown>) | null = null;
  private readonly pending = new Set<Promise<void>>();
  constructor(private readonly logger: Logger, private readonly attempts = 3, private readonly baseDelayMs = 1_000) {}

  bind(process: (ref: JobRef) => Promise<unknown>) {
    this.process = process;
  }

  async enqueue(ref: JobRef) {
    // Fail fast in the caller's await, not as an unhandled rejection later.
    if (!this.process) throw new Error('InlineDispatcher used before bind()');
    const run = this.run(ref, 1).finally(() => this.pending.delete(run));
    this.pending.add(run);
  }

  /** Test helper: wait for all in-flight work. */
  async drain() {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  private async run(ref: JobRef, attempt: number): Promise<void> {
    try {
      await new Promise((r) => setImmediate(r));
      await this.process!(ref);
    } catch (err) {
      if (err instanceof RetryableJobError && attempt < this.attempts) {
        await new Promise((r) => setTimeout(r, this.baseDelayMs * 2 ** (attempt - 1)));
        return this.run(ref, attempt + 1);
      }
      this.logger.error('job.dispatch_failed', { jobId: ref.jobId, error: err instanceof Error ? err.message : 'unknown' });
    }
  }
}
