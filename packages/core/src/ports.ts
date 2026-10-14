import type { AvailabilityResult, ProviderMode } from './availability';
import type { CandidateKind } from './handles/candidates';
import type { JobStatus, NextAction } from './jobs';
import type { PlatformConfig } from './platforms';

/**
 * Persistence ports. Services depend on these interfaces only; `@sha/db`
 * implements them with Postgres + RLS and tests use in-memory fakes.
 */

export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export interface AuthContext {
  userId: string;
  workspaceId: string;
  email: string;
  role: Role;
  requestId: string;
  ip?: string | undefined;
}

export interface PlatformHandle {
  handle: string;
  valid: boolean;
  issues: string[];
}

export interface StoredCandidate {
  handle: string;
  kind: CandidateKind;
  relevance: number;
  /** Platform-specific shape of this candidate (slug → handle). */
  perPlatform: Record<string, PlatformHandle>;
}

export interface CheckRecord {
  id: string;
  workspaceId: string;
  createdBy: string;
  originalInput: string;
  requestedHandle: string | null;
  normalizedHandle: string;
  providerMode: ProviderMode;
  platforms: string[];
  candidates: StoredCandidate[];
  createdAt: string;
  results: AvailabilityResult[];
}

export interface NewCheck {
  createdBy: string;
  originalInput: string;
  requestedHandle: string | null;
  normalizedHandle: string;
  providerMode: ProviderMode;
  platforms: string[];
  candidates: StoredCandidate[];
}

export interface JobEvent {
  fromStatus: JobStatus | null;
  toStatus: JobStatus;
  message: string;
  actorUserId: string | null;
  createdAt: string;
}

export interface JobRecord {
  id: string;
  workspaceId: string;
  checkId: string;
  requestedBy: string;
  platform: string;
  handle: string;
  email: string;
  status: JobStatus;
  attempts: number;
  lastError: string | null;
  storeCredentials: boolean;
  nextAction: NextAction | null;
  providerMode: ProviderMode;
  createdAt: string;
  updatedAt: string;
  events: JobEvent[];
}

export interface NewJob {
  checkId: string;
  requestedBy: string;
  platform: string;
  handle: string;
  email: string;
  providerMode: ProviderMode;
}

export interface JobPatch {
  status?: JobStatus;
  attempts?: number;
  lastError?: string | null;
  nextAction?: NextAction | null;
}

export interface AuditEventInput {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface WorkspaceRepos {
  checks: {
    create(input: NewCheck): Promise<{ id: string; createdAt: string }>;
    get(id: string): Promise<CheckRecord | null>;
    upsertResults(checkId: string, results: AvailabilityResult[]): Promise<void>;
  };
  observations: { append(results: AvailabilityResult[]): Promise<void> };
  jobs: {
    create(input: NewJob): Promise<JobRecord>;
    get(id: string): Promise<JobRecord | null>;
    list(limit: number): Promise<JobRecord[]>;
    findActive(platform: string, handle: string): Promise<JobRecord | null>;
    /** Optimistic: applies only if the job is still in `expectedStatus`. Returns null otherwise. */
    update(id: string, expectedStatus: JobStatus, patch: JobPatch, event: { message: string; actorUserId: string | null }): Promise<JobRecord | null>;
  };
  audit: { record(event: AuditEventInput): Promise<void> };
}

/** Runs `fn` in one transaction scoped (via RLS) to a single workspace. */
export interface UnitOfWork {
  run<T>(workspaceId: string, fn: (repos: WorkspaceRepos) => Promise<T>): Promise<T>;
}

export interface PlatformCatalogPort {
  listEnabled(): Promise<PlatformConfig[]>;
}

export interface UserProvisionerPort {
  provision(email: string): Promise<{ userId: string; workspaceId: string; role: Role }>;
}
