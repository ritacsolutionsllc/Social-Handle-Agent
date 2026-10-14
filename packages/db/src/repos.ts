import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  PlatformConfigSchema,
  type AuditEventInput,
  type AvailabilityResult,
  type CheckRecord,
  type JobRecord,
  type JobStatus,
  type PlatformCatalogPort,
  type PlatformConfig,
  type ProviderMode,
  type Role,
  type UnitOfWork,
  type UserProvisionerPort,
  type WorkspaceRepos,
} from '@sha/core';
import { withWorkspace, type Db, type Tx } from './client';
import * as t from './schema';

type ResultRow = typeof t.handleCheckResults.$inferSelect;
type JobRow = typeof t.accountCreationJobs.$inferSelect;
type EventRow = typeof t.accountCreationJobEvents.$inferSelect;

const iso = (s: string) => new Date(s).toISOString();

function toResult(r: ResultRow): AvailabilityResult {
  return {
    platform: r.platform,
    handle: r.handle,
    status: r.status as AvailabilityResult['status'],
    confidence: r.confidence as AvailabilityResult['confidence'],
    checkedAt: iso(r.checkedAt),
    source: r.source,
    simulated: r.simulated,
    ...(r.profileUrl ? { profileUrl: r.profileUrl } : {}),
    ...(r.reason ? { reason: r.reason as AvailabilityResult['reason'] } : {}),
    ...(r.evidence ? { evidence: r.evidence } : {}),
    ...(r.error ? { error: r.error } : {}),
  };
}

function toJob(r: JobRow, events: EventRow[]): JobRecord {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    checkId: r.checkId,
    requestedBy: r.requestedBy,
    platform: r.platform,
    handle: r.handle,
    email: r.email,
    status: r.status as JobStatus,
    attempts: r.attempts,
    lastError: r.lastError,
    storeCredentials: r.storeCredentials,
    nextAction: r.nextAction ?? null,
    providerMode: r.providerMode as ProviderMode,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    events: events.map((e) => ({
      fromStatus: (e.fromStatus as JobStatus | null) ?? null,
      toStatus: e.toStatus as JobStatus,
      message: e.message,
      actorUserId: e.actorUserId,
      createdAt: iso(e.createdAt),
    })),
  };
}

function resultValues(workspaceId: string, checkId: string, r: AvailabilityResult) {
  return {
    handleCheckId: checkId,
    workspaceId,
    platform: r.platform,
    handle: r.handle,
    status: r.status,
    confidence: r.confidence,
    profileUrl: r.profileUrl ?? null,
    source: r.source,
    reason: r.reason ?? null,
    evidence: r.evidence ?? null,
    error: r.error ?? null,
    simulated: r.simulated,
    checkedAt: r.checkedAt,
  };
}

/** Repositories bound to one RLS-scoped transaction. */
export function workspaceRepos(tx: Tx, workspaceId: string): WorkspaceRepos {
  const loadJobs = async (rows: JobRow[]) => {
    if (rows.length === 0) return [];
    const events = await tx
      .select()
      .from(t.accountCreationJobEvents)
      .where(inArray(t.accountCreationJobEvents.jobId, rows.map((r) => r.id)))
      .orderBy(asc(t.accountCreationJobEvents.id));
    return rows.map((r) => toJob(r, events.filter((e) => e.jobId === r.id)));
  };

  return {
    checks: {
      async create(input) {
        const [row] = await tx
          .insert(t.handleChecks)
          .values({ workspaceId, ...input })
          .returning({ id: t.handleChecks.id, createdAt: t.handleChecks.createdAt });
        return { id: row!.id, createdAt: iso(row!.createdAt) };
      },
      async get(id) {
        const [c] = await tx.select().from(t.handleChecks).where(eq(t.handleChecks.id, id));
        if (!c) return null;
        const results = await tx.select().from(t.handleCheckResults).where(eq(t.handleCheckResults.handleCheckId, id));
        const record: CheckRecord = {
          id: c.id,
          workspaceId: c.workspaceId,
          createdBy: c.createdBy,
          originalInput: c.originalInput,
          requestedHandle: c.requestedHandle,
          normalizedHandle: c.normalizedHandle,
          providerMode: c.providerMode as ProviderMode,
          platforms: c.platforms,
          candidates: c.candidates,
          createdAt: iso(c.createdAt),
          results: results.map(toResult),
        };
        return record;
      },
      async upsertResults(checkId, results) {
        if (results.length === 0) return;
        const rows = results.map((r) => resultValues(workspaceId, checkId, r));
        await tx
          .insert(t.handleCheckResults)
          .values(rows)
          .onConflictDoUpdate({
            target: [t.handleCheckResults.handleCheckId, t.handleCheckResults.platform, t.handleCheckResults.handle],
            set: {
              status: sql`excluded.status`,
              confidence: sql`excluded.confidence`,
              profileUrl: sql`excluded.profile_url`,
              source: sql`excluded.source`,
              reason: sql`excluded.reason`,
              evidence: sql`excluded.evidence`,
              error: sql`excluded.error`,
              simulated: sql`excluded.simulated`,
              checkedAt: sql`excluded.checked_at`,
            },
          });
      },
    },
    observations: {
      async append(results) {
        if (results.length === 0) return;
        await tx.insert(t.availabilityObservations).values(
          results.map((r) => ({
            workspaceId,
            platform: r.platform,
            handle: r.handle,
            status: r.status,
            confidence: r.confidence,
            source: r.source,
            reason: r.reason ?? null,
            evidence: r.evidence ?? null,
            simulated: r.simulated,
            checkedAt: r.checkedAt,
          })),
        );
      },
    },
    jobs: {
      async create(input) {
        const [row] = await tx.insert(t.accountCreationJobs).values({ workspaceId, ...input, status: 'queued' }).returning();
        await tx.insert(t.accountCreationJobEvents).values({
          jobId: row!.id,
          workspaceId,
          fromStatus: null,
          toStatus: 'queued',
          message: 'Job created after explicit per-platform confirmation.',
          actorUserId: input.requestedBy,
        });
        return (await loadJobs([row!]))[0]!;
      },
      async get(id) {
        const rows = await tx.select().from(t.accountCreationJobs).where(eq(t.accountCreationJobs.id, id));
        return (await loadJobs(rows))[0] ?? null;
      },
      async list(limit) {
        const rows = await tx.select().from(t.accountCreationJobs).orderBy(desc(t.accountCreationJobs.createdAt)).limit(limit);
        return loadJobs(rows);
      },
      async findActive(platform, handle) {
        const rows = await tx
          .select()
          .from(t.accountCreationJobs)
          .where(
            and(
              eq(t.accountCreationJobs.platform, platform),
              eq(t.accountCreationJobs.handle, handle),
              inArray(t.accountCreationJobs.status, ['queued', 'running', 'awaiting_verification']),
            ),
          );
        return (await loadJobs(rows))[0] ?? null;
      },
      async update(id, expectedStatus, patch, event) {
        const [row] = await tx
          .update(t.accountCreationJobs)
          .set({ ...patch, updatedAt: sql`now()` })
          .where(and(eq(t.accountCreationJobs.id, id), eq(t.accountCreationJobs.status, expectedStatus)))
          .returning();
        if (!row) return null;
        await tx.insert(t.accountCreationJobEvents).values({
          jobId: id,
          workspaceId,
          fromStatus: expectedStatus,
          toStatus: row.status,
          message: event.message,
          actorUserId: event.actorUserId,
        });
        return (await loadJobs([row]))[0]!;
      },
    },
    audit: {
      async record(e: AuditEventInput) {
        await tx.insert(t.auditEvents).values({
          workspaceId,
          actorUserId: e.actorUserId,
          action: e.action,
          entityType: e.entityType,
          entityId: e.entityId ?? null,
          metadata: e.metadata ?? {},
        });
      },
    },
  };
}

export function createUnitOfWork(db: Db): UnitOfWork {
  return { run: (workspaceId, fn) => withWorkspace(db, workspaceId, (tx) => fn(workspaceRepos(tx, workspaceId))) };
}

function rowToPlatform(r: typeof t.platforms.$inferSelect): PlatformConfig {
  return PlatformConfigSchema.parse({
    slug: r.slug,
    name: r.name,
    enabled: r.enabled,
    sortOrder: r.sortOrder,
    adapterKey: r.adapterKey,
    entityType: r.entityType,
    entityDescription: r.entityDescription,
    usernameRules: r.usernameRules,
    profileUrlTemplate: r.profileUrlTemplate,
    registrationUrl: r.registrationUrl,
    availabilityStrategy: r.availabilityStrategy,
    availabilityNotes: r.availabilityNotes,
    ...(r.derivedFrom ? { derivedFrom: r.derivedFrom } : {}),
    creationStrategy: r.creationStrategy,
    manualSteps: r.manualSteps,
    rateLimitPolicy: r.rateLimitPolicy,
    requiredCredentials: r.requiredCredentials,
  });
}

/** Platform catalog with a short in-process cache (config changes apply within ttlMs). */
export function createPlatformCatalog(db: Db, ttlMs = 30_000): PlatformCatalogPort {
  let cached: { at: number; value: PlatformConfig[] } | null = null;
  return {
    async listEnabled() {
      if (cached && Date.now() - cached.at < ttlMs) return cached.value;
      const rows = await db.select().from(t.platforms).where(eq(t.platforms.enabled, true)).orderBy(asc(t.platforms.sortOrder));
      cached = { at: Date.now(), value: rows.map(rowToPlatform) };
      return cached.value;
    },
  };
}

export function createUserProvisioner(db: Db): UserProvisionerPort {
  return {
    async provision(email) {
      const rows = await db.execute<{ user_id: string; workspace_id: string; role: string }>(sql`select * from app.provision_user(${email})`);
      const r = rows[0];
      if (!r) throw new Error('user provisioning returned no row');
      return { userId: r.user_id, workspaceId: r.workspace_id, role: r.role as Role };
    },
  };
}
