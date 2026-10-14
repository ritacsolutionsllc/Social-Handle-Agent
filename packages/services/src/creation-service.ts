import {
  assertTransition,
  AVAILABILITY_DISCLAIMER,
  DomainError,
  isCancellable,
  isRetryable,
  notFound,
  type AuthContext,
  type AvailabilityResult,
  type CreationJobsRequest,
  type CreationPlanRequest,
  type JobRecord,
  type PlatformConfig,
} from '@sha/core';
import { requireWriter, type ServiceDeps } from './deps';
import { buildReport, summarizePlatform, type CellResult, type PlatformSummary } from './report';

export interface CreationPlanItem {
  platform: PlatformSummary;
  handle: string;
  email: string;
  storeCredentials: false;
  workflow: PlatformConfig['creationStrategy'];
  manualSteps: string[];
  verificationExpected: string;
  latestResult: CellResult | null;
  warnings: string[];
  blocked: boolean;
  blockedReason?: string;
}

export interface CreationPlan {
  checkId: string;
  handle: string;
  email: string;
  providerMode: 'mock' | 'live';
  simulated: boolean;
  creationEnabled: boolean;
  items: CreationPlanItem[];
  notes: string[];
}

const PLAN_NOTES = [
  AVAILABILITY_DISCLAIMER,
  'No platform offers an account-creation API for this workflow; every platform uses guided manual registration. You complete signup and any verification yourself.',
  'Passwords and verification codes are never requested or stored by this app.',
  'The chosen handle is re-checked immediately before jobs are created and again when each job runs.',
];

export class CreationService {
  constructor(private readonly deps: ServiceDeps) {}

  /** Read-only preview. Allowed even when ACCOUNT_CREATION_ENABLED=false. */
  async previewPlan(ctx: AuthContext, req: CreationPlanRequest): Promise<CreationPlan> {
    const check = await this.deps.uow.run(ctx.workspaceId, (r) => r.checks.get(req.checkId));
    if (!check) throw notFound('Check');
    const handle = req.handle.toLowerCase().replace(/^@/, '');
    const candidate = check.candidates.find((c) => c.handle === handle);
    if (!candidate) throw new DomainError('validation_error', 'Handle is not one of the candidates for this check.', 400);
    const unknownPlatforms = req.platforms.filter((p) => !check.platforms.includes(p));
    if (unknownPlatforms.length) throw new DomainError('validation_error', `Platform(s) not part of this check: ${unknownPlatforms.join(', ')}`, 400);

    const platforms = await this.deps.catalog.listEnabled();
    const report = buildReport(check, platforms);
    const cells = report.candidates.find((c) => c.handle === handle)!.cells;

    const items = req.platforms.map((slug): CreationPlanItem => {
      const p = platforms.find((x) => x.slug === slug);
      if (!p) throw new DomainError('validation_error', `Platform ${slug} is disabled.`, 400);
      const ph = candidate.perPlatform[slug]!;
      const cell = cells[slug] ?? null;
      const warnings: string[] = [];
      let blockedReason: string | undefined;
      if (!ph.valid) blockedReason = `"${ph.handle}" is not a valid ${p.name} username (${ph.issues.join('; ')}).`;
      else if (cell?.status === 'taken') blockedReason = `Appears taken on ${p.name}.`;
      else if (p.creationStrategy === 'unsupported') blockedReason = `${p.name} registration is not supported.`;
      if (ph.handle !== handle) warnings.push(`Adjusted to "${ph.handle}" for ${p.name} rules.`);
      if (!cell || cell.status !== 'available') warnings.push(`Availability on ${p.name} is not confirmed (${cell?.status ?? 'not checked'}); verify during signup.`);
      if (cell?.simulated) warnings.push('The availability result is SIMULATED (mock provider), not a real platform check.');
      if (p.entityType === 'linked_profile' && p.derivedFrom) warnings.push(`Handle is inherited from ${p.derivedFrom}; claim it there first.`);
      return {
        platform: summarizePlatform(p),
        handle: ph.handle,
        email: ctx.email,
        storeCredentials: false,
        workflow: p.creationStrategy,
        manualSteps: p.manualSteps,
        verificationExpected: 'Expect email and/or phone verification and possibly a captcha, completed by you on the platform.',
        latestResult: cell,
        warnings,
        blocked: blockedReason !== undefined,
        ...(blockedReason ? { blockedReason } : {}),
      };
    });

    return {
      checkId: check.id,
      handle,
      email: ctx.email,
      providerMode: check.providerMode,
      simulated: check.providerMode === 'mock',
      creationEnabled: this.deps.settings.ACCOUNT_CREATION_ENABLED,
      items,
      notes: PLAN_NOTES,
    };
  }

  /**
   * Create creation jobs after explicit per-platform confirmation (validated by
   * CreationJobsRequestSchema). Rejected BEFORE any enqueue when disabled.
   * Credentials being configured never implies authorization.
   */
  async createJobs(ctx: AuthContext, req: CreationJobsRequest): Promise<JobRecord[]> {
    if (!this.deps.settings.ACCOUNT_CREATION_ENABLED) {
      await this.deps.uow.run(ctx.workspaceId, (r) =>
        r.audit.record({ actorUserId: ctx.userId, action: 'creation.rejected_disabled', entityType: 'handle_check', entityId: req.checkId, metadata: { platforms: req.platforms } }),
      );
      throw new DomainError('feature_disabled', 'Account creation is disabled on this server (ACCOUNT_CREATION_ENABLED=false). You can still review the creation plan.', 403);
    }
    requireWriter(ctx);

    const plan = await this.previewPlan(ctx, req);
    const blocked = plan.items.filter((i) => i.blocked);
    if (blocked.length) {
      throw new DomainError('handle_unavailable', 'Some selected platforms cannot proceed.', 409, blocked.map((b) => ({ platform: b.platform.slug, reason: b.blockedReason })));
    }

    // Fresh re-verification immediately before any registration attempt.
    const platforms = await this.deps.catalog.listEnabled();
    const fresh: AvailabilityResult[] = await this.deps.checker.checkMany(
      plan.items.map((i) => ({ platform: platforms.find((p) => p.slug === i.platform.slug)!, handle: i.handle })),
      { signal: AbortSignal.timeout(this.deps.settings.CHECK_DEADLINE_MS), bypassCache: true },
    );
    const nowTaken = fresh.filter((r) => r.status === 'taken');

    const jobs = await this.deps.uow.run(ctx.workspaceId, async (repos) => {
      await repos.checks.upsertResults(req.checkId, fresh);
      await repos.observations.append(fresh);
      if (nowTaken.length) return null;
      const created: JobRecord[] = [];
      for (const item of plan.items) {
        if (await repos.jobs.findActive(item.platform.slug, item.handle)) {
          throw new DomainError('conflict', `An active job already exists for ${item.platform.name} @${item.handle}.`, 409);
        }
        const job = await repos.jobs.create({
          checkId: req.checkId,
          requestedBy: ctx.userId,
          platform: item.platform.slug,
          handle: item.handle,
          email: ctx.email,
          providerMode: plan.providerMode,
        });
        await repos.audit.record({
          actorUserId: ctx.userId,
          action: 'creation_job.created',
          entityType: 'account_creation_job',
          entityId: job.id,
          metadata: { platform: job.platform, handle: job.handle, confirmed: true, requestId: ctx.requestId },
        });
        created.push(job);
      }
      return created;
    });

    if (!jobs) {
      throw new DomainError('handle_unavailable', 'The handle was re-checked and now appears taken.', 409, nowTaken.map((r) => ({ platform: r.platform, reason: r.evidence ?? 'taken' })));
    }
    // Enqueue only after the transaction committed (no phantom jobs).
    for (const j of jobs) await this.deps.dispatcher.enqueue({ workspaceId: ctx.workspaceId, jobId: j.id });
    return jobs;
  }

  async getJob(ctx: AuthContext, id: string): Promise<JobRecord> {
    const job = await this.deps.uow.run(ctx.workspaceId, (r) => r.jobs.get(id));
    if (!job) throw notFound('Job');
    return job;
  }

  listJobs(ctx: AuthContext): Promise<JobRecord[]> {
    return this.deps.uow.run(ctx.workspaceId, (r) => r.jobs.list(100));
  }

  async cancel(ctx: AuthContext, id: string): Promise<JobRecord> {
    requireWriter(ctx);
    return this.deps.uow.run(ctx.workspaceId, async (r) => {
      const job = await r.jobs.get(id);
      if (!job) throw notFound('Job');
      if (!isCancellable(job.status)) throw new DomainError('invalid_transition', `A ${job.status} job cannot be cancelled.`, 409);
      const updated = await r.jobs.update(id, job.status, { status: 'cancelled' }, { message: 'Cancelled by user.', actorUserId: ctx.userId });
      if (!updated) throw new DomainError('conflict', 'The job changed concurrently; refresh and try again.', 409);
      await r.audit.record({ actorUserId: ctx.userId, action: 'creation_job.cancelled', entityType: 'account_creation_job', entityId: id });
      return updated;
    });
  }

  async retry(ctx: AuthContext, id: string): Promise<JobRecord> {
    if (!this.deps.settings.ACCOUNT_CREATION_ENABLED) throw new DomainError('feature_disabled', 'Account creation is disabled on this server.', 403);
    requireWriter(ctx);
    const updated = await this.deps.uow.run(ctx.workspaceId, async (r) => {
      const job = await r.jobs.get(id);
      if (!job) throw notFound('Job');
      if (!isRetryable(job.status)) throw new DomainError('invalid_transition', `A ${job.status} job cannot be retried.`, 409);
      if (await r.jobs.findActive(job.platform, job.handle)) throw new DomainError('conflict', 'Another active job exists for this handle.', 409);
      const u = await r.jobs.update(id, job.status, { status: 'queued', lastError: null, nextAction: null }, { message: 'Retried by user.', actorUserId: ctx.userId });
      if (!u) throw new DomainError('conflict', 'The job changed concurrently; refresh and try again.', 409);
      await r.audit.record({ actorUserId: ctx.userId, action: 'creation_job.retried', entityType: 'account_creation_job', entityId: id });
      return u;
    });
    await this.deps.dispatcher.enqueue({ workspaceId: ctx.workspaceId, jobId: id });
    return updated;
  }

  /**
   * User reports they finished manual registration. We re-check: if the handle
   * still looks confidently available, signup evidently didn't complete.
   */
  async confirmCompleted(ctx: AuthContext, id: string): Promise<JobRecord> {
    requireWriter(ctx);
    const job = await this.getJob(ctx, id);
    assertTransition(job.status, 'succeeded');
    const platform = (await this.deps.catalog.listEnabled()).find((p) => p.slug === job.platform);
    if (!platform) throw new DomainError('validation_error', 'Platform is disabled.', 400);
    const r = await this.deps.checker.checkOne({ platform, handle: job.handle }, { signal: AbortSignal.timeout(this.deps.settings.CHECK_DEADLINE_MS), bypassCache: true });
    if (r.status === 'available' && r.confidence !== 'low') {
      throw new DomainError('conflict', `@${job.handle} still appears available on ${platform.name}. Finish registration first, then confirm.`, 409);
    }
    const message =
      r.status === 'taken'
        ? `Verified: profile now exists (${r.source}${r.simulated ? ', simulated' : ''}).`
        : `Confirmed by user; automated verification not possible (${r.status}).`;
    return this.deps.uow.run(ctx.workspaceId, async (repos) => {
      await repos.observations.append([r]);
      const updated = await repos.jobs.update(id, job.status, { status: 'succeeded' }, { message, actorUserId: ctx.userId });
      if (!updated) throw new DomainError('conflict', 'The job changed concurrently; refresh and try again.', 409);
      await repos.audit.record({ actorUserId: ctx.userId, action: 'creation_job.confirmed', entityType: 'account_creation_job', entityId: id, metadata: { verification: r.status, source: r.source } });
      return updated;
    });
  }
}
