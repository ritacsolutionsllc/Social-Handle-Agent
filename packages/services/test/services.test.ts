import { describe, expect, it } from 'vitest';
import { DomainError, PLATFORM_CATALOG, type CreationJobsRequest } from '@sha/core';
import { AvailabilityChecker, createLiveRegistry, MemoryCache, type LiveAdapterDeps } from '@sha/platforms';
import { CheckService, CreationService, MockCreationAdapter, processCreationJob, RetryableJobError, createLogger } from '../src';
import { ctx, makeDeps } from './fakes';

const ALL = ['x', 'instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'pinterest', 'reddit', 'snapchat', 'threads'];

async function expectDomainError(p: Promise<unknown>, code: string, status: number) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(DomainError);
  expect(err).toMatchObject({ code, status });
  return err as DomainError;
}

describe('CheckService (mock provider)', () => {
  it('runs the vertical slice: primary + alternatives, ranked recommendation, labelled simulated', async () => {
    const { deps, store } = makeDeps();
    const report = await new CheckService(deps).runCheck(ctx(), { input: 'Acme Robotics', requestedHandle: 'acmerobotics', includeAlternatives: true });
    expect(report.simulated).toBe(true);
    expect(report.providerMode).toBe('mock');
    expect(report.primary.handle).toBe('acmerobotics');
    expect(report.primary.cells.x).toMatchObject({ status: 'taken', simulated: true, profileUrl: 'https://x.com/acmerobotics' });
    expect(report.primary.cells.facebook).toMatchObject({ status: 'unknown', reason: 'unsupported' });
    expect(report.candidates.length).toBeGreaterThan(5);
    expect(report.recommendation?.handle).toBe('acmeroboticshq');
    expect(report.recommendation?.reason).toMatch(/verified manually/);
    expect(report.disclaimer).toMatch(/do not reserve/);
    // Persisted + audited + history appended
    expect(store.checks.size).toBe(1);
    expect(store.audit.map((a) => a.action)).toEqual(['check.created']);
    expect(store.observations.length).toBeGreaterThan(10);
  });

  it('marks platform-invalid handles instead of checking them', async () => {
    const { deps } = makeDeps();
    const r = await new CheckService(deps).runCheck(ctx(), { input: 'acme', platforms: ['x', 'reddit'], includeAlternatives: false });
    expect(r.primary.cells.x).toMatchObject({ status: 'unknown', reason: 'invalid_for_platform', valid: false });
  });

  it('rejects unknown platforms and inputs without usable characters', async () => {
    const { deps } = makeDeps();
    const s = new CheckService(deps);
    await expectDomainError(s.runCheck(ctx(), { input: 'Acme', platforms: ['myspace'], includeAlternatives: true }), 'validation_error', 400);
    await expectDomainError(s.runCheck(ctx(), { input: '!!!', includeAlternatives: true }), 'validation_error', 400);
  });

  it('forbids viewers from running checks', async () => {
    const { deps } = makeDeps();
    await expectDomainError(new CheckService(deps).runCheck(ctx({ role: 'viewer' }), { input: 'Acme', includeAlternatives: false }), 'forbidden', 403);
  });

  it('isolates checks by workspace', async () => {
    const { deps } = makeDeps();
    const s = new CheckService(deps);
    const r = await s.runCheck(ctx(), { input: 'Acme Robotics', includeAlternatives: false });
    await expectDomainError(s.getReport(ctx({ workspaceId: 'ws-bob', userId: 'u-bob' }), r.id), 'not_found', 404);
  });

  it('rechecks a single cell bypassing the cache', async () => {
    const { deps, store } = makeDeps();
    const s = new CheckService(deps);
    const r = await s.runCheck(ctx(), { input: 'Acme Robotics', includeAlternatives: false });
    await s.recheck(ctx(), r.id, 'reddit', 'acmerobotics');
    expect(store.audit.at(-1)?.action).toBe('check.rechecked');
    await expectDomainError(s.recheck(ctx(), r.id, 'reddit', 'someoneelse'), 'validation_error', 400);
  });
});

describe('CheckService (live provider, no credentials)', () => {
  it('never returns simulated data; unconfigured checks are explicit unknowns', async () => {
    const live: LiveAdapterDeps = {
      fetch: async () => { throw new Error('network disabled in tests'); },
      credentials: () => undefined,
      now: () => new Date(),
      userAgent: 'test',
      robots: { isAllowed: async () => false },
    };
    const { deps } = makeDeps({ registry: createLiveRegistry(live, (s) => (s === 'instagram' ? instagramConfig() : undefined)) });
    const r = await new CheckService(deps).runCheck(ctx(), { input: 'Acme Robotics', includeAlternatives: false });
    expect(r.simulated).toBe(false);
    const cells = Object.values(r.primary.cells).filter((c) => c !== null);
    expect(cells.every((c) => c!.simulated === false)).toBe(true);
    expect(cells.some((c) => c!.status === 'available')).toBe(false);
    expect(r.primary.cells.x).toMatchObject({ status: 'unknown', reason: 'missing_credentials' });
    expect(r.primary.cells.youtube).toMatchObject({ status: 'unknown', reason: 'robots_disallowed' });
    expect(r.recommendation).toBeNull();
  });
});
const instagramConfig = () => PLATFORM_CATALOG.find((p) => p.slug === 'instagram');

async function seedCheck(deps: ReturnType<typeof makeDeps>['deps']) {
  return new CheckService(deps).runCheck(ctx(), { input: 'Acme Robotics', requestedHandle: 'acmerobotics', includeAlternatives: true });
}
const jobsReq = (checkId: string, platforms: string[], handle = 'acmeroboticshq'): CreationJobsRequest => ({ checkId, handle, platforms, confirmedPlatforms: platforms, acknowledgedTerms: true });

describe('CreationService — ACCOUNT_CREATION_ENABLED=false', () => {
  it('allows the plan preview, with guided-manual workflow and no stored credentials', async () => {
    const { deps } = makeDeps();
    const check = await seedCheck(deps);
    const plan = await new CreationService(deps).previewPlan(ctx(), { checkId: check.id, handle: 'acmeroboticshq', platforms: ['x', 'threads', 'facebook'] });
    expect(plan.creationEnabled).toBe(false);
    expect(plan.simulated).toBe(true);
    expect(plan.items.map((i) => i.workflow)).toEqual(['guided_manual', 'guided_manual', 'guided_manual']);
    expect(plan.items.every((i) => i.storeCredentials === false && i.email === 'alice@example.test')).toBe(true);
    expect(plan.items.find((i) => i.platform.slug === 'threads')!.warnings.join(' ')).toMatch(/inherited from instagram/);
    expect(plan.items.find((i) => i.platform.slug === 'facebook')!.warnings.join(' ')).toMatch(/not confirmed/);
    expect(plan.notes.join(' ')).toMatch(/do not reserve/);
  });

  it('rejects job creation before anything is enqueued or rechecked, and audits the attempt', async () => {
    const { deps, store, dispatcher } = makeDeps();
    const check = await seedCheck(deps);
    await expectDomainError(new CreationService(deps).createJobs(ctx(), jobsReq(check.id, ['x'])), 'feature_disabled', 403);
    expect(dispatcher.enqueued).toEqual([]);
    expect(store.jobs.size).toBe(0);
    expect(store.audit.at(-1)?.action).toBe('creation.rejected_disabled');
  });

  it('does not treat configured credentials as authorization', async () => {
    process.env.X_BEARER_TOKEN = 'configured-but-irrelevant';
    try {
      const { deps, dispatcher } = makeDeps();
      const check = await seedCheck(deps);
      await expectDomainError(new CreationService(deps).createJobs(ctx(), jobsReq(check.id, ['x'])), 'feature_disabled', 403);
      expect(dispatcher.enqueued).toEqual([]);
    } finally {
      delete process.env.X_BEARER_TOKEN;
    }
  });
});

describe('CreationService — enabled', () => {
  const enabled = () => makeDeps({ settings: { ACCOUNT_CREATION_ENABLED: true, AVAILABILITY_PROVIDER_MODE: 'mock', CHECK_DEADLINE_MS: 5000 } });

  it('creates one job per confirmed platform and enqueues after commit', async () => {
    const { deps, dispatcher, store } = enabled();
    const check = await seedCheck(deps);
    const jobs = await new CreationService(deps).createJobs(ctx(), jobsReq(check.id, ['x', 'reddit']));
    expect(jobs.map((j) => [j.platform, j.status])).toEqual([['x', 'queued'], ['reddit', 'queued']]);
    expect(dispatcher.enqueued.map((e) => e.jobId)).toEqual(jobs.map((j) => j.id));
    expect(store.audit.filter((a) => a.action === 'creation_job.created')).toHaveLength(2);
  });

  it('blocks platforms where the handle appears taken or invalid', async () => {
    const { deps, dispatcher } = enabled();
    const check = await seedCheck(deps);
    const err = await expectDomainError(new CreationService(deps).createJobs(ctx(), jobsReq(check.id, ['x', 'youtube'], 'acmerobotics')), 'handle_unavailable', 409);
    expect(JSON.stringify(err.details)).toMatch(/x/);
    expect(dispatcher.enqueued).toEqual([]);
  });

  it('refuses a handle that is not a candidate of the check', async () => {
    const { deps } = enabled();
    const check = await seedCheck(deps);
    await expectDomainError(new CreationService(deps).createJobs(ctx(), jobsReq(check.id, ['x'], 'notacandidate')), 'validation_error', 400);
  });

  it('prevents duplicate active jobs', async () => {
    const { deps } = enabled();
    const check = await seedCheck(deps);
    const s = new CreationService(deps);
    await s.createJobs(ctx(), jobsReq(check.id, ['reddit']));
    await expectDomainError(s.createJobs(ctx(), jobsReq(check.id, ['reddit'])), 'conflict', 409);
  });

  it('processes a job to awaiting_verification with guided manual instructions', async () => {
    const { deps } = enabled();
    const check = await seedCheck(deps);
    const [job] = await new CreationService(deps).createJobs(ctx(), jobsReq(check.id, ['reddit']));
    const done = await processCreationJob(deps, { workspaceId: 'ws-alice', jobId: job!.id });
    expect(done).toMatchObject({ status: 'awaiting_verification', attempts: 1 });
    expect(done!.nextAction).toMatchObject({ type: 'manual_registration', registrationUrl: 'https://www.reddit.com/register/', prefill: { handle: 'acmeroboticshq', email: 'alice@example.test' } });
    expect(done!.events.map((e) => e.toStatus)).toEqual(['queued', 'running', 'awaiting_verification']);
    // Duplicate delivery is a no-op
    expect((await processCreationJob(deps, { workspaceId: 'ws-alice', jobId: job!.id }))!.status).toBe('awaiting_verification');
  });

  it('fails a queued job if creation was disabled after enqueue (defence in depth)', async () => {
    const { deps } = enabled();
    const check = await seedCheck(deps);
    const [job] = await new CreationService(deps).createJobs(ctx(), jobsReq(check.id, ['reddit']));
    const off = { ...deps, settings: { ...deps.settings, ACCOUNT_CREATION_ENABLED: false } };
    expect(await processCreationJob(off, { workspaceId: 'ws-alice', jobId: job!.id })).toMatchObject({ status: 'failed', lastError: expect.stringMatching(/disabled/) });
  });

  it('retries transient errors then fails after max attempts (mock creation adapter)', async () => {
    const adapter = new MockCreationAdapter('throw');
    const { deps } = makeDeps({ creationAdapter: adapter, maxJobAttempts: 2, settings: { ACCOUNT_CREATION_ENABLED: true, AVAILABILITY_PROVIDER_MODE: 'mock', CHECK_DEADLINE_MS: 5000 } });
    const check = await seedCheck(deps);
    const [job] = await new CreationService(deps).createJobs(ctx(), jobsReq(check.id, ['reddit']));
    const ref = { workspaceId: 'ws-alice', jobId: job!.id };
    await expect(processCreationJob(deps, ref)).rejects.toBeInstanceOf(RetryableJobError);
    expect(await processCreationJob(deps, ref)).toMatchObject({ status: 'failed', attempts: 2 });
    expect(adapter.calls).toEqual(['reddit:acmeroboticshq', 'reddit:acmeroboticshq']);
  });

  it('cancel / retry / confirm follow the state machine', async () => {
    const { deps, dispatcher } = enabled();
    const check = await seedCheck(deps);
    const s = new CreationService(deps);
    const [job] = await s.createJobs(ctx(), jobsReq(check.id, ['reddit']));
    expect((await s.cancel(ctx(), job!.id)).status).toBe('cancelled');
    await expectDomainError(s.cancel(ctx(), job!.id), 'invalid_transition', 409);
    expect((await s.retry(ctx(), job!.id)).status).toBe('queued');
    expect(dispatcher.enqueued).toHaveLength(2);
    await processCreationJob(deps, { workspaceId: 'ws-alice', jobId: job!.id });
    // Mock Reddit still says "available" at high confidence → user hasn't finished signup.
    await expectDomainError(s.confirmCompleted(ctx(), job!.id), 'conflict', 409);
  });

  it('confirms completion when verification no longer shows the handle as available', async () => {
    const { deps } = enabled();
    const check = await seedCheck(deps);
    const s = new CreationService(deps);
    const [job] = await s.createJobs(ctx(), jobsReq(check.id, ['facebook']));
    await processCreationJob(deps, { workspaceId: 'ws-alice', jobId: job!.id });
    const ok = await s.confirmCompleted(ctx(), job!.id);
    expect(ok.status).toBe('succeeded');
    expect(ok.events.at(-1)?.message).toMatch(/automated verification not possible/);
  });
});

describe('logger', () => {
  it('redacts secrets in structured logs', () => {
    const lines: string[] = [];
    createLogger({ service: 't' }, (l) => lines.push(l)).info('x', { authorization: 'Bearer abc', nested: { password: 'p', ok: 1 }, apiKey: 'k' });
    const out = lines[0]!;
    expect(out).not.toMatch(/abc|"p"|"k"/);
    expect(JSON.parse(out)).toMatchObject({ level: 'info', msg: 'x', service: 't', nested: { password: '[REDACTED]', ok: 1 } });
  });
});

describe('logger depth guard', () => {
  it('never emits an unredacted subtree beyond the depth limit', () => {
    const lines: string[] = [];
    let deep: Record<string, unknown> = { password: 'hunter2' };
    for (let i = 0; i < 10; i++) deep = { nested: deep };
    createLogger({}, (l) => lines.push(l)).info('x', deep);
    expect(lines[0]).not.toContain('hunter2');
  });
});

describe('job lifecycle hardening (review fixes)', () => {
  const enabledSettings = { ACCOUNT_CREATION_ENABLED: true, AVAILABILITY_PROVIDER_MODE: 'mock' as const, CHECK_DEADLINE_MS: 5000 };

  it('a worker finishing a cancelled attempt cannot overwrite the retried attempt', async () => {
    // Adapter that pauses so we can cancel + retry while attempt 1 is in flight.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = { key: 'slow', prepare: async (job: import('@sha/core').JobRecord, p: import('@sha/core').PlatformConfig) => { await gate; return new MockCreationAdapter('awaiting').prepare(job, p); } };
    const { deps } = makeDeps({ creationAdapter: slow, settings: enabledSettings });
    const check = await seedCheck(deps);
    const s = new CreationService(deps);
    const [job] = await s.createJobs(ctx(), jobsReq(check.id, ['reddit']));
    const ref = { workspaceId: 'ws-alice', jobId: job!.id };
    const attempt1 = processCreationJob(deps, ref);
    await new Promise((r) => setTimeout(r, 5));
    await s.cancel(ctx(), job!.id);
    const retried = await s.retry(ctx(), job!.id);
    expect(retried).toMatchObject({ status: 'queued', attempts: 0, generation: 2 });
    release();
    expect(await attempt1).toBeNull(); // stale attempt's result discarded
    expect((await s.getJob(ctx(), job!.id)).status).toBe('queued');
  });

  it('recovers a job stuck in running after its lease expires', async () => {
    const { deps, store } = makeDeps({ settings: enabledSettings });
    const check = await seedCheck(deps);
    const [job] = await new CreationService(deps).createJobs(ctx(), jobsReq(check.id, ['reddit']));
    const stored = store.jobs.get(job!.id)!;
    stored.status = 'running';
    stored.updatedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const out = await processCreationJob({ ...deps, now: () => new Date() }, { workspaceId: 'ws-alice', jobId: job!.id });
    expect(out?.status).toBe('awaiting_verification');
    expect(out?.events.some((e) => /stale running attempt/.test(e.message))).toBe(true);
  });

  it('only accepts manual confirmation from awaiting_verification', async () => {
    const { deps } = makeDeps({ settings: enabledSettings });
    const check = await seedCheck(deps);
    const s = new CreationService(deps);
    const [job] = await s.createJobs(ctx(), jobsReq(check.id, ['facebook']));
    await expectDomainError(s.confirmCompleted(ctx(), job!.id), 'invalid_transition', 409); // still queued
  });

  it('marks a job failed (retryable) when dispatch fails after commit', async () => {
    const { deps } = makeDeps({ settings: enabledSettings, dispatcher: { enqueue: async () => { throw new Error('redis down'); } } });
    const check = await seedCheck(deps);
    const s = new CreationService(deps);
    const [job] = await s.createJobs(ctx(), jobsReq(check.id, ['reddit']));
    expect(job).toMatchObject({ status: 'failed', lastError: expect.stringMatching(/Retry/) });
  });

  it('rolls back the whole batch when one platform conflicts', async () => {
    const { deps, store } = makeDeps({ settings: enabledSettings });
    const check = await seedCheck(deps);
    const s = new CreationService(deps);
    await s.createJobs(ctx(), jobsReq(check.id, ['reddit']));
    const before = store.jobs.size;
    await expectDomainError(s.createJobs(ctx(), jobsReq(check.id, ['x', 'reddit'])), 'conflict', 409);
    expect(store.jobs.size).toBe(before); // the 'x' job from the failed batch was rolled back
  });

  it('refuses a recheck under a different provider mode', async () => {
    const { deps } = makeDeps();
    const r = await new CheckService(deps).runCheck(ctx(), { input: 'Acme Robotics', includeAlternatives: false });
    const liveChecker = new AvailabilityChecker({ registry: { mode: 'live', get: () => undefined }, cache: new MemoryCache(), cacheTtlSeconds: 300, concurrency: 2 });
    await expectDomainError(new CheckService({ ...deps, checker: liveChecker }).recheck(ctx(), r.id, 'reddit', 'acmerobotics'), 'conflict', 409);
  });
});
