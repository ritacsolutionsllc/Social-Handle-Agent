import type { AppSettings, AuthContext, JobRecord, NextAction, PlatformCatalogPort, PlatformConfig, Role, UnitOfWork } from '@sha/core';
import { DomainError } from '@sha/core';
import type { AvailabilityChecker, Logger } from '@sha/platforms';

export interface JobRef {
  workspaceId: string;
  jobId: string;
}

/** Hands a persisted job to the queue. Called only after the DB transaction commits. */
export interface JobDispatcher {
  enqueue(ref: JobRef): Promise<void>;
}

export type CreationOutcome =
  | { outcome: 'awaiting_verification'; nextAction: NextAction; message: string }
  | { outcome: 'succeeded'; message: string }
  | { outcome: 'failed'; error: string };

/**
 * Executes the provisioning step for one platform. v1 ships only
 * GuidedManualCreationAdapter (prepares instructions, contacts no platform);
 * MockCreationAdapter exists for automated tests.
 */
export interface CreationAdapter {
  readonly key: string;
  prepare(job: JobRecord, platform: PlatformConfig, signal: AbortSignal): Promise<CreationOutcome>;
}

export interface ServiceDeps {
  uow: UnitOfWork;
  catalog: PlatformCatalogPort;
  checker: AvailabilityChecker;
  settings: Pick<AppSettings, 'ACCOUNT_CREATION_ENABLED' | 'AVAILABILITY_PROVIDER_MODE' | 'CHECK_DEADLINE_MS'>;
  dispatcher: JobDispatcher;
  creationAdapters: Record<string, CreationAdapter>;
  logger: Logger;
  now?: () => Date;
  maxJobAttempts?: number;
}

const WRITE_ROLES: readonly Role[] = ['owner', 'admin', 'member'];

export function requireWriter(ctx: AuthContext): void {
  if (!WRITE_ROLES.includes(ctx.role)) throw new DomainError('forbidden', 'Your role does not allow this action.', 403);
}

export async function resolvePlatforms(catalog: PlatformCatalogPort, slugs?: string[]): Promise<PlatformConfig[]> {
  const all = await catalog.listEnabled();
  if (!slugs) return all;
  const unknown = slugs.filter((s) => !all.some((p) => p.slug === s));
  if (unknown.length > 0) throw new DomainError('validation_error', `Unknown or disabled platform(s): ${unknown.join(', ')}`, 400, { platforms: unknown });
  return all.filter((p) => slugs.includes(p.slug));
}
