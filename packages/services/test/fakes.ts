import { randomUUID } from 'node:crypto';
import { PLATFORM_CATALOG, type AuditEventInput, type AuthContext, type AvailabilityResult, type CheckRecord, type JobRecord, type UnitOfWork, type WorkspaceRepos } from '@sha/core';
import { AvailabilityChecker, createMockRegistry, MemoryCache, type AdapterRegistry } from '@sha/platforms';
import { GuidedManualCreationAdapter, type CreationAdapter, type JobRef, type ServiceDeps } from '../src';

/** In-memory UnitOfWork that mimics RLS: every read/write is scoped to the workspace. */
export class FakeStore implements UnitOfWork {
  checks = new Map<string, CheckRecord>();
  jobs = new Map<string, JobRecord>();
  audit: Array<AuditEventInput & { workspaceId: string }> = [];
  observations: AvailabilityResult[] = [];

  /** Transactional like the real UnitOfWork: all writes are rolled back if `fn` throws. */
  async run<T>(ws: string, fn: (r: WorkspaceRepos) => Promise<T>): Promise<T> {
    const snapshot = { checks: structuredClone(this.checks), jobs: structuredClone(this.jobs), audit: structuredClone(this.audit), observations: structuredClone(this.observations) };
    try {
      return await this.runInner(ws, fn);
    } catch (err) {
      this.checks = snapshot.checks;
      this.jobs = snapshot.jobs;
      this.audit = snapshot.audit;
      this.observations = snapshot.observations;
      throw err;
    }
  }

  private async runInner<T>(ws: string, fn: (r: WorkspaceRepos) => Promise<T>): Promise<T> {
    const own = <V extends { workspaceId: string }>(v: V | undefined) => (v && v.workspaceId === ws ? v : null);
    const repos: WorkspaceRepos = {
      checks: {
        create: async (input) => {
          const id = randomUUID();
          const createdAt = new Date().toISOString();
          this.checks.set(id, { id, workspaceId: ws, createdAt, results: [], ...input });
          return { id, createdAt };
        },
        get: async (id) => structuredClone(own(this.checks.get(id))),
        upsertResults: async (id, results) => {
          const c = own(this.checks.get(id));
          if (!c) throw new Error('rls: check not visible');
          for (const r of results) {
            c.results = c.results.filter((x) => !(x.platform === r.platform && x.handle === r.handle));
            c.results.push(r);
          }
        },
      },
      observations: { append: async (rs) => void this.observations.push(...rs) },
      jobs: {
        create: async (input) => {
          const now = new Date().toISOString();
          const job: JobRecord = { id: randomUUID(), workspaceId: ws, status: 'queued', attempts: 0, generation: 0, lastError: null, storeCredentials: false, nextAction: null, createdAt: now, updatedAt: now, events: [{ fromStatus: null, toStatus: 'queued', message: 'created', actorUserId: input.requestedBy, createdAt: now }], ...input };
          this.jobs.set(job.id, job);
          return structuredClone(job);
        },
        get: async (id) => structuredClone(own(this.jobs.get(id))),
        list: async () => [...this.jobs.values()].filter((j) => j.workspaceId === ws).map((j) => structuredClone(j)),
        findActive: async (platform, handle) =>
          [...this.jobs.values()].find((j) => j.workspaceId === ws && j.platform === platform && j.handle === handle && ['queued', 'running', 'awaiting_verification'].includes(j.status)) ?? null,
        update: async (id, expected, patch, event, expectedGeneration) => {
          const j = own(this.jobs.get(id));
          if (!j || j.status !== expected) return null;
          if (expectedGeneration !== undefined && j.generation !== expectedGeneration) return null;
          Object.assign(j, patch, { updatedAt: new Date().toISOString() });
          j.events.push({ fromStatus: expected, toStatus: j.status, message: event.message, actorUserId: event.actorUserId, createdAt: j.updatedAt });
          return structuredClone(j);
        },
      },
      audit: { record: async (e) => void this.audit.push({ ...e, workspaceId: ws }) },
    };
    return fn(repos);
  }
}

export class RecordingDispatcher {
  enqueued: JobRef[] = [];
  async enqueue(ref: JobRef) {
    this.enqueued.push(ref);
  }
}

export function makeDeps(overrides: Partial<ServiceDeps> & { registry?: AdapterRegistry; creationAdapter?: CreationAdapter } = {}) {
  const store = new FakeStore();
  const dispatcher = new RecordingDispatcher();
  const { registry, creationAdapter, ...rest } = overrides;
  const deps: ServiceDeps = {
    uow: store,
    catalog: { listEnabled: async () => [...PLATFORM_CATALOG] },
    checker: new AvailabilityChecker({ registry: registry ?? createMockRegistry(), cache: new MemoryCache(), cacheTtlSeconds: 300, concurrency: 8, sleep: async () => {} }),
    settings: { ACCOUNT_CREATION_ENABLED: false, AVAILABILITY_PROVIDER_MODE: 'mock', CHECK_DEADLINE_MS: 5000 },
    dispatcher,
    creationAdapters: { guided_manual: creationAdapter ?? new GuidedManualCreationAdapter() },
    logger: { info() {}, warn() {}, error() {} },
    now: () => new Date('2026-10-14T00:00:00Z'),
    ...rest,
  };
  return { deps, store, dispatcher };
}

export const ctx = (over: Partial<AuthContext> = {}): AuthContext => ({
  userId: 'u-alice', workspaceId: 'ws-alice', email: 'alice@example.test', role: 'owner', requestId: 'req-1', ...over,
});
