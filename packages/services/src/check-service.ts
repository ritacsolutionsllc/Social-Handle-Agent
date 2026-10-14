import {
  canonicalize,
  DomainError,
  generateCandidates,
  normalizeForPlatform,
  notFound,
  type AuthContext,
  type AvailabilityResult,
  type CheckRequest,
  type PlatformConfig,
  type StoredCandidate,
} from '@sha/core';
import type { CheckTask } from '@sha/platforms';
import { requireWriter, resolvePlatforms, type ServiceDeps } from './deps';
import { buildReport, type CheckReport } from './report';

export function shapeCandidates(input: string, requestedHandle: string | undefined, platforms: PlatformConfig[], now: Date): StoredCandidate[] {
  return generateCandidates({ input, requestedHandle, now }).map((c) => ({
    ...c,
    perPlatform: Object.fromEntries(
      platforms.map((p) => {
        const n = normalizeForPlatform(c.handle, p.usernameRules);
        return [p.slug, { handle: n.handle, valid: n.valid, issues: n.issues }];
      }),
    ),
  }));
}

function tasksFor(candidates: StoredCandidate[], platforms: PlatformConfig[], seen: Set<string>): CheckTask[] {
  const tasks: CheckTask[] = [];
  for (const c of candidates) {
    for (const p of platforms) {
      const ph = c.perPlatform[p.slug];
      if (!ph?.valid) continue;
      const key = `${p.slug}:${ph.handle}`;
      if (seen.has(key)) continue; // e.g. "acme.robotics" and "acmerobotics" collapse on X
      seen.add(key);
      tasks.push({ platform: p, handle: ph.handle });
    }
  }
  return tasks;
}

export class CheckService {
  constructor(private readonly deps: ServiceDeps) {}

  private get now() {
    return (this.deps.now ?? (() => new Date()))();
  }

  /** Candidate preview without any availability checks (no network, no persistence). */
  async suggestions(input: string, requestedHandle?: string) {
    const platforms = await this.deps.catalog.listEnabled();
    const candidates = shapeCandidates(input, requestedHandle, platforms, this.now);
    if (candidates.length === 0) throw new DomainError('validation_error', 'Input contains no usable handle characters.', 400);
    return { primary: candidates[0]!.handle, candidates };
  }

  async runCheck(ctx: AuthContext, req: CheckRequest): Promise<CheckReport> {
    requireWriter(ctx);
    const platforms = await resolvePlatforms(this.deps.catalog, req.platforms);
    const candidates = shapeCandidates(req.input, req.requestedHandle, platforms, this.now);
    if (candidates.length === 0) throw new DomainError('validation_error', 'Input contains no usable handle characters.', 400);

    const signal = AbortSignal.timeout(this.deps.settings.CHECK_DEADLINE_MS);
    const seen = new Set<string>();
    const [primary, ...alternatives] = candidates;
    const results: AvailabilityResult[] = await this.deps.checker.checkMany(tasksFor([primary!], platforms, seen), { signal });

    const primaryFullyAvailable = results.length === platforms.length && results.every((r) => r.status === 'available');
    if (req.includeAlternatives && !primaryFullyAvailable && alternatives.length > 0) {
      results.push(...(await this.deps.checker.checkMany(tasksFor(alternatives, platforms, seen), { signal })));
    }

    const record = await this.deps.uow.run(ctx.workspaceId, async (repos) => {
      const created = await repos.checks.create({
        createdBy: ctx.userId,
        originalInput: req.input,
        requestedHandle: req.requestedHandle ? canonicalize(req.requestedHandle) : null,
        normalizedHandle: primary!.handle,
        providerMode: this.deps.checker.mode,
        platforms: platforms.map((p) => p.slug),
        candidates,
      });
      await repos.checks.upsertResults(created.id, results);
      await repos.observations.append(results);
      await repos.audit.record({
        actorUserId: ctx.userId,
        action: 'check.created',
        entityType: 'handle_check',
        entityId: created.id,
        metadata: { providerMode: this.deps.checker.mode, platforms: platforms.map((p) => p.slug), checks: results.length, requestId: ctx.requestId },
      });
      return repos.checks.get(created.id);
    });

    this.deps.logger.info('check.completed', { requestId: ctx.requestId, checkId: record!.id, results: results.length, mode: this.deps.checker.mode });
    return buildReport(record!, platforms);
  }

  async getReport(ctx: AuthContext, id: string): Promise<CheckReport> {
    const check = await this.deps.uow.run(ctx.workspaceId, (r) => r.checks.get(id));
    if (!check) throw notFound('Check');
    return buildReport(check, await this.deps.catalog.listEnabled());
  }

  /** Fresh (cache-bypassing) recheck of one cell of an existing check. */
  async recheck(ctx: AuthContext, id: string, platformSlug: string, handle: string): Promise<CheckReport> {
    requireWriter(ctx);
    const check = await this.deps.uow.run(ctx.workspaceId, (r) => r.checks.get(id));
    if (!check) throw notFound('Check');
    const platform = (await this.deps.catalog.listEnabled()).find((p) => p.slug === platformSlug);
    const normalized = handle.toLowerCase().replace(/^@/, '');
    const belongs = check.platforms.includes(platformSlug) && check.candidates.some((c) => c.perPlatform[platformSlug]?.valid && c.perPlatform[platformSlug]?.handle === normalized);
    if (!platform || !belongs) throw new DomainError('validation_error', 'That platform/handle pair is not part of this check.', 400);

    const result = await this.deps.checker.checkOne({ platform, handle: normalized }, { signal: AbortSignal.timeout(this.deps.settings.CHECK_DEADLINE_MS), bypassCache: true });
    const updated = await this.deps.uow.run(ctx.workspaceId, async (repos) => {
      await repos.checks.upsertResults(id, [result]);
      await repos.observations.append([result]);
      await repos.audit.record({ actorUserId: ctx.userId, action: 'check.rechecked', entityType: 'handle_check', entityId: id, metadata: { platform: platformSlug, handle: normalized, status: result.status } });
      return repos.checks.get(id);
    });
    return buildReport(updated!, await this.deps.catalog.listEnabled());
  }
}
