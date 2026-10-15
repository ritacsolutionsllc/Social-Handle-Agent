import { describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { RetryableJobError, RUNNING_LEASE_MS, type ServiceDeps } from '@sha/services';
import { BullMqDispatcher, CREATION_QUEUE, InlineDispatcher, startCreationWorker } from '../src';

const silent = { info() {}, warn() {}, error() {} };

describe('InlineDispatcher', () => {
  it('retries RetryableJobError with backoff, then stops', async () => {
    const d = new InlineDispatcher(silent, 3, 1);
    const calls: string[] = [];
    d.bind(async (ref) => {
      calls.push(ref.jobId);
      if (calls.length < 3) throw new RetryableJobError('transient');
    });
    await d.enqueue({ workspaceId: 'w', jobId: 'j1' });
    await d.drain();
    expect(calls).toEqual(['j1', 'j1', 'j1']);
  });
  it('retries unexpected errors within the same attempt budget (processor is idempotent)', async () => {
    const d = new InlineDispatcher(silent, 3, 1);
    let n = 0;
    d.bind(async () => { n++; throw new Error('transient db error'); });
    await d.enqueue({ workspaceId: 'w', jobId: 'j2' });
    await d.drain();
    expect(n).toBe(3);
  });
});

const redisUrl = process.env.TEST_REDIS_URL;
describe.skipIf(!redisUrl)('BullMQ round-trip (TEST_REDIS_URL)', () => {
  it('delivers every enqueue (no id-based dedupe; the processor CAS makes duplicates harmless)', async () => {
    const conn = new Redis(redisUrl!, { maxRetriesPerRequest: null });
    await conn.flushdb();
    const seen: string[] = [];
    // Minimal deps: processCreationJob reads the job via uow; a missing job is skipped harmlessly.
    const deps = {
      logger: silent,
      uow: { run: async (_ws: string, fn: (r: unknown) => Promise<unknown>) => fn({ jobs: { get: async (id: string) => { seen.push(id); return null; } } }) },
    } as unknown as ServiceDeps;
    const worker = startCreationWorker(deps, conn, 1);
    const dispatcher = new BullMqDispatcher(conn, 3, silent);
    await dispatcher.enqueue({ workspaceId: 'w', jobId: 'job-a' });
    await dispatcher.enqueue({ workspaceId: 'w', jobId: 'job-a' }); // e.g. a retry racing an old delivery
    const deadline = Date.now() + 5000;
    while (seen.length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(seen).toEqual(['job-a', 'job-a']);
    await worker.close();
    await dispatcher.close();
    await conn.quit();
  });

  it('parks a delivery that finds the job running under a live lease until the lease expires', async () => {
    const conn = new Redis(redisUrl!, { maxRetriesPerRequest: null });
    await conn.flushdb();
    const updatedAt = new Date().toISOString();
    let reads = 0;
    const deps = {
      logger: silent,
      uow: { run: async (_ws: string, fn: (r: unknown) => Promise<unknown>) => fn({ jobs: { get: async () => { reads++; return { id: 'job-r', status: 'running', updatedAt }; } } }) },
    } as unknown as ServiceDeps;
    const failed: string[] = [];
    const worker = startCreationWorker(deps, conn, 1);
    worker.on('failed', (_j, err) => failed.push(err.message));
    const queue = new Queue(CREATION_QUEUE, { connection: conn });
    await new BullMqDispatcher(conn, 3, silent).enqueue({ workspaceId: 'w', jobId: 'job-r' });
    const deadline = Date.now() + 5000;
    while ((await queue.getDelayedCount()) === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    const [parked] = await queue.getDelayed();
    expect(reads).toBe(1);
    expect(failed).toEqual([]);
    expect(parked!.delay + parked!.timestamp).toBeGreaterThanOrEqual(new Date(updatedAt).getTime() + RUNNING_LEASE_MS);
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await conn.quit();
  });
});

describe('InlineDispatcher misuse', () => {
  it('rejects enqueue before bind() in the caller instead of an unhandled rejection', async () => {
    await expect(new InlineDispatcher(silent).enqueue({ workspaceId: 'w', jobId: 'j' })).rejects.toThrow(/before bind/);
  });
});

describe('BullMqDispatcher error handling', () => {
  it('logs queue errors instead of crashing the process', async () => {
    const conn = new Redis('redis://127.0.0.1:1', { lazyConnect: true, maxRetriesPerRequest: null, retryStrategy: () => null });
    conn.on('error', () => {});
    const errors: string[] = [];
    const logger = { info() {}, warn() {}, error: (msg: string) => void errors.push(msg) };
    const d = new BullMqDispatcher(conn, 3, logger);
    const { queue } = d as unknown as { queue: { emit(e: string, err: Error): boolean } };
    expect(() => queue.emit('error', new Error('connection lost'))).not.toThrow();
    expect(errors).toContain('queue.error');
    await d.close().catch(() => {});
    conn.disconnect();
  });
});
