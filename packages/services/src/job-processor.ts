import type { JobRecord } from '@sha/core';
import type { JobRef, ServiceDeps } from './deps';

export class RetryableJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableJobError';
  }
}

const safeMessage = (err: unknown) => (err instanceof Error ? err.message.slice(0, 300) : 'unknown error');

/** A `running` job untouched for this long is assumed to belong to a lost worker. */
export const RUNNING_LEASE_MS = 10 * 60 * 1000;

/**
 * Processes one account-creation job. Idempotent: anything not `queued` is skipped,
 * and every transition is a compare-and-set on (status, generation), so duplicate
 * deliveries are harmless and a worker still finishing a cancelled attempt can never
 * overwrite a newer one (cancel/retry bump the generation).
 *
 * A job left `running` past RUNNING_LEASE_MS (worker crashed mid-attempt) is moved back
 * to `queued` by the next delivery instead of being skipped forever.
 *
 * Throws RetryableJobError when the queue should retry (job is put back to `queued`).
 */
export async function processCreationJob(deps: ServiceDeps, ref: JobRef, signal: AbortSignal = AbortSignal.timeout(60_000)): Promise<JobRecord | null> {
  const log = deps.logger;
  const maxAttempts = deps.maxJobAttempts ?? 3;
  const now = deps.now ?? (() => new Date());
  const { uow } = deps;
  const ws = ref.workspaceId;

  let job = await uow.run(ws, (r) => r.jobs.get(ref.jobId));
  if (job?.status === 'running' && now().getTime() - new Date(job.updatedAt).getTime() > RUNNING_LEASE_MS) {
    const stale = job;
    job = await uow.run(ws, (r) =>
      r.jobs.update(stale.id, 'running', { status: 'queued' }, { message: 'Recovered a stale running attempt (worker lost); requeued.', actorUserId: null }, stale.generation),
    );
    log.warn('job.recovered_stale', { jobId: ref.jobId });
  }
  if (!job || job.status !== 'queued') {
    log.info('job.skipped', { jobId: ref.jobId, status: job?.status ?? 'missing' });
    return job;
  }

  const gen = job.generation;
  const queuedJob = job;
  const running = await uow.run(ws, (r) =>
    r.jobs.update(queuedJob.id, 'queued', { status: 'running', attempts: queuedJob.attempts + 1 }, { message: `Attempt ${queuedJob.attempts + 1} started.`, actorUserId: null }, gen),
  );
  if (!running) return null; // another worker took it, or the user cancelled
  log.info('job.started', { jobId: running.id, platform: running.platform, attempt: running.attempts });

  const fail = (error: string) =>
    uow.run(ws, async (r) => {
      const u = await r.jobs.update(running.id, 'running', { status: 'failed', lastError: error }, { message: error, actorUserId: null }, gen);
      if (u) await r.audit.record({ actorUserId: null, action: 'creation_job.failed', entityType: 'account_creation_job', entityId: running.id, metadata: { error } });
      return u;
    });

  // Defence in depth: the API already refused, but a queued job must not run if the switch was turned off.
  if (!deps.settings.ACCOUNT_CREATION_ENABLED) return fail('Account creation is disabled on this server.');

  try {
    const platform = (await deps.catalog.listEnabled()).find((p) => p.slug === running.platform);
    if (!platform) return fail(`Platform ${running.platform} is no longer enabled.`);
    const adapter = deps.creationAdapters[platform.creationStrategy];
    if (!adapter) return fail(`No creation workflow is available for ${platform.name}.`);

    // Re-verify right before the attempt; never proceed on a handle that now looks taken.
    const recheck = await deps.checker.checkOne({ platform, handle: running.handle }, { signal, bypassCache: true });
    await uow.run(ws, (r) => r.observations.append([recheck]));
    if (recheck.status === 'taken') return fail(`@${running.handle} now appears taken on ${platform.name} (${recheck.source}).`);

    const out = await adapter.prepare(running, platform, signal);
    return await uow.run(ws, async (r) => {
      if (out.outcome === 'failed') {
        const u = await r.jobs.update(running.id, 'running', { status: 'failed', lastError: out.error }, { message: out.error, actorUserId: null }, gen);
        if (u) await r.audit.record({ actorUserId: null, action: 'creation_job.failed', entityType: 'account_creation_job', entityId: running.id, metadata: { error: out.error } });
        return u;
      }
      const to = out.outcome;
      const note = recheck.status === 'available' ? '' : ` Pre-check result: ${recheck.status}; confirm availability during signup.`;
      const u = await r.jobs.update(
        running.id,
        'running',
        { status: to, lastError: null, nextAction: out.outcome === 'awaiting_verification' ? out.nextAction : null },
        { message: out.message + note, actorUserId: null },
        gen,
      );
      // u === null: the job was cancelled/retried meanwhile; this stale attempt's result is discarded.
      if (u) await r.audit.record({ actorUserId: null, action: `creation_job.${to}`, entityType: 'account_creation_job', entityId: running.id, metadata: { adapter: adapter.key } });
      return u;
    });
  } catch (err) {
    const message = safeMessage(err);
    log.warn('job.attempt_failed', { jobId: running.id, attempt: running.attempts, error: message });
    if (running.attempts < maxAttempts) {
      await uow.run(ws, (r) =>
        r.jobs.update(running.id, 'running', { status: 'queued', lastError: message }, { message: `Attempt ${running.attempts} failed; will retry.`, actorUserId: null }, gen),
      );
      throw new RetryableJobError(message);
    }
    return fail(`Gave up after ${running.attempts} attempts: ${message}`);
  }
}
