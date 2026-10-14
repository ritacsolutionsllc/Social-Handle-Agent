import { describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { RetryableJobError, type ServiceDeps } from '@sha/services';
import { BullMqDispatcher, InlineDispatcher, startCreationWorker } from '../src';

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
  it('does not retry non-retryable errors', async () => {
    const d = new InlineDispatcher(silent, 3, 1);
    let n = 0;
    d.bind(async () => { n++; throw new Error('permanent'); });
    await d.enqueue({ workspaceId: 'w', jobId: 'j2' });
    await d.drain();
    expect(n).toBe(1);
  });
});

const redisUrl = process.env.TEST_REDIS_URL;
describe.skipIf(!redisUrl)('BullMQ round-trip (TEST_REDIS_URL)', () => {
  it('delivers a job reference to the worker exactly once per enqueue id', async () => {
    const conn = new Redis(redisUrl!, { maxRetriesPerRequest: null });
    await conn.flushdb();
    const seen: string[] = [];
    // Minimal deps: processCreationJob reads the job via uow; a missing job is skipped harmlessly.
    const deps = {
      logger: silent,
      uow: { run: async (_ws: string, fn: (r: unknown) => Promise<unknown>) => fn({ jobs: { get: async (id: string) => { seen.push(id); return null; } } }) },
    } as unknown as ServiceDeps;
    const worker = startCreationWorker(deps, conn, 1);
    const dispatcher = new BullMqDispatcher(conn, 3);
    await dispatcher.enqueue({ workspaceId: 'w', jobId: 'job-a' });
    await dispatcher.enqueue({ workspaceId: 'w', jobId: 'job-a' }); // deduped while pending
    const deadline = Date.now() + 5000;
    while (seen.length < 1 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 200));
    expect(seen).toEqual(['job-a']);
    await worker.close();
    await dispatcher.close();
    await conn.quit();
  });
});

describe('InlineDispatcher misuse', () => {
  it('rejects enqueue before bind() in the caller instead of an unhandled rejection', async () => {
    await expect(new InlineDispatcher(silent).enqueue({ workspaceId: 'w', jobId: 'j' })).rejects.toThrow(/before bind/);
  });
});
