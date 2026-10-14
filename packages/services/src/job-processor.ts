import type { JobRecord } from '@sha/core';
import type { JobRef, ServiceDeps } from './deps';

export class RetryableJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableJobError';
  }
}

const safeMessage = (err: unknown) => (err instanceof Error ? err.message.slice(0, 300) : 'unknown error');

/**
 * Processes one account-creation job. Idempotent: anything not `queued` is
 * skipped, and every transition is optimistic on the expected status, so
 * duplicate deliveries from the queue are harmless.
 *
 * Throws RetryableJobError when the queue should retry (job is put back to `queued`).
 */
export async function processCreationJob(deps: ServiceDeps, ref: JobRef, signal: AbortSignal = AbortSignal.timeout(60_000)): Promise<JobRecord | null> {
  const log = deps.logger;
  const maxAttempts = deps.maxJobAttempts ?? 3;
  const { uow } = deps;
  const ws = ref.workspaceId;

  const job = await uow.run(ws, (r) => r.jobs.get(ref.jobId));
  if (!job || job.status !== 'queued') {
    log.info('job.skipped', { jobId: ref.jobId, status: job?.status ?? 'missing' });
    return job;
  }

  const running = await uow.run(ws, (r) =>
    r.jobs.update(job.id, 'queued', { status: 'running', attempts: job.attempts + 1 }, { message: `Attempt ${job.attempts + 1} started.`, actorUserId: null }),
  );
  if (!running) return null; // another worker took it, or the user cancelled
  log.info('job.started', { jobId: job.id, platform: job.platform, attempt: running.attempts });

  const fail = (error: string) =>
    uow.run(ws, async (r) => {
      const u = await r.jobs.update(job.id, 'running', { status: 'failed', lastError: error }, { message: error, actorUserId: null });
      await r.audit.record({ actorUserId: null, action: 'creation_job.failed', entityType: 'account_creation_job', entityId: job.id, metadata: { error } });
      return u;
    });

  // Defence in depth: the API already refused, but a queued job must not run if the switch was turned off.
  if (!deps.settings.ACCOUNT_CREATION_ENABLED) return fail('Account creation is disabled on this server.');

  try {
    const platform = (await deps.catalog.listEnabled()).find((p) => p.slug === job.platform);
    if (!platform) return fail(`Platform ${job.platform} is no longer enabled.`);
    const adapter = deps.creationAdapters[platform.creationStrategy];
    if (!adapter) return fail(`No creation workflow is available for ${platform.name}.`);

    // Re-verify right before the attempt; never proceed on a handle that now looks taken.
    const recheck = await deps.checker.checkOne({ platform, handle: job.handle }, { signal, bypassCache: true });
    await uow.run(ws, (r) => r.observations.append([recheck]));
    if (recheck.status === 'taken') return fail(`@${job.handle} now appears taken on ${platform.name} (${recheck.source}).`);

    const out = await adapter.prepare(running, platform, signal);
    return await uow.run(ws, async (r) => {
      if (out.outcome === 'failed') {
        const u = await r.jobs.update(job.id, 'running', { status: 'failed', lastError: out.error }, { message: out.error, actorUserId: null });
        await r.audit.record({ actorUserId: null, action: 'creation_job.failed', entityType: 'account_creation_job', entityId: job.id, metadata: { error: out.error } });
        return u;
      }
      const to = out.outcome;
      const note = recheck.status === 'available' ? '' : ` Pre-check result: ${recheck.status}; confirm availability during signup.`;
      const u = await r.jobs.update(
        job.id,
        'running',
        { status: to, lastError: null, nextAction: out.outcome === 'awaiting_verification' ? out.nextAction : null },
        { message: out.message + note, actorUserId: null },
      );
      await r.audit.record({ actorUserId: null, action: `creation_job.${to}`, entityType: 'account_creation_job', entityId: job.id, metadata: { adapter: adapter.key } });
      return u;
    });
  } catch (err) {
    const message = safeMessage(err);
    log.warn('job.attempt_failed', { jobId: job.id, attempt: running.attempts, error: message });
    if (running.attempts < maxAttempts) {
      await uow.run(ws, (r) => r.jobs.update(job.id, 'running', { status: 'queued', lastError: message }, { message: `Attempt ${running.attempts} failed; will retry.`, actorUserId: null }));
      throw new RetryableJobError(message);
    }
    return fail(`Gave up after ${running.attempts} attempts: ${message}`);
  }
}
