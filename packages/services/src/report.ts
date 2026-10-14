import {
  AVAILABILITY_DISCLAIMER,
  rankCandidates,
  recommend,
  type AvailabilityResult,
  type CheckRecord,
  type PlatformConfig,
  type ProviderMode,
  type StoredCandidate,
} from '@sha/core';

/** Public, secret-free platform metadata for the UI (no credential names). */
export interface PlatformSummary {
  slug: string;
  name: string;
  entityType: PlatformConfig['entityType'];
  entityDescription: string;
  availabilityStrategy: PlatformConfig['availabilityStrategy'];
  availabilityNotes: string;
  creationStrategy: PlatformConfig['creationStrategy'];
  manualSteps: string[];
  registrationUrl: string;
  profileUrlTemplate: string;
}

export interface CellResult extends AvailabilityResult {
  valid: boolean;
  issues: string[];
}

export interface CandidateReport {
  handle: string;
  kind: StoredCandidate['kind'];
  rank: number;
  availableCount: number;
  takenCount: number;
  uncertainCount: number;
  /** Platforms not checked for this candidate (alternatives are only checked when needed). */
  uncheckedCount: number;
  cells: Record<string, CellResult | null>;
}

export interface CheckReport {
  id: string;
  originalInput: string;
  requestedHandle: string | null;
  primaryHandle: string;
  providerMode: ProviderMode;
  simulated: boolean;
  createdAt: string;
  disclaimer: string;
  platforms: PlatformSummary[];
  primary: CandidateReport;
  candidates: CandidateReport[];
  recommendation: { handle: string; reason: string } | null;
}

export function summarizePlatform(p: PlatformConfig): PlatformSummary {
  return {
    slug: p.slug,
    name: p.name,
    entityType: p.entityType,
    entityDescription: p.entityDescription,
    availabilityStrategy: p.availabilityStrategy,
    availabilityNotes: p.availabilityNotes,
    creationStrategy: p.creationStrategy,
    manualSteps: p.manualSteps,
    registrationUrl: p.registrationUrl,
    profileUrlTemplate: p.profileUrlTemplate,
  };
}

function invalidCell(platform: string, handle: string, issues: string[], simulated: boolean): CellResult {
  return {
    platform,
    handle,
    status: 'unknown',
    confidence: 'low',
    checkedAt: new Date(0).toISOString(),
    source: 'validation',
    reason: 'invalid_for_platform',
    evidence: `Not a valid username here: ${issues.join('; ') || 'violates platform rules'}.`,
    simulated,
    valid: false,
    issues,
  };
}

export function buildReport(check: CheckRecord, platforms: PlatformConfig[]): CheckReport {
  const selected = platforms.filter((p) => check.platforms.includes(p.slug));
  const simulated = check.providerMode === 'mock';
  const byKey = new Map(check.results.map((r) => [`${r.platform}:${r.handle}`, r]));

  const cellsFor = (c: StoredCandidate): Record<string, CellResult | null> =>
    Object.fromEntries(
      selected.map((p) => {
        const ph = c.perPlatform[p.slug];
        if (!ph) return [p.slug, null];
        if (!ph.valid) return [p.slug, invalidCell(p.slug, ph.handle, ph.issues, simulated)];
        const r = byKey.get(`${p.slug}:${ph.handle}`);
        return [p.slug, r ? { ...r, valid: true, issues: ph.issues } : null];
      }),
    );

  const cellMap = new Map(check.candidates.map((c) => [c.handle, cellsFor(c)]));
  const ranked = rankCandidates(check.candidates, (c) => Object.values(cellMap.get(c.handle) ?? {}).filter((x): x is CellResult => x !== null));
  const toReport = (rc: (typeof ranked)[number], i: number): CandidateReport => {
    const cells = cellMap.get(rc.candidate.handle)!;
    return {
      handle: rc.candidate.handle,
      kind: (rc.candidate as StoredCandidate).kind,
      rank: i + 1,
      availableCount: rc.availableCount,
      takenCount: rc.takenCount,
      uncertainCount: rc.uncertainCount,
      uncheckedCount: Object.values(cells).filter((c) => c === null).length,
      cells,
    };
  };
  const candidates = ranked.map(toReport);
  const primary = candidates.find((c) => c.kind === 'primary')!;
  const best = recommend(ranked);

  return {
    id: check.id,
    originalInput: check.originalInput,
    requestedHandle: check.requestedHandle,
    primaryHandle: check.normalizedHandle,
    providerMode: check.providerMode,
    simulated,
    createdAt: check.createdAt,
    disclaimer: AVAILABILITY_DISCLAIMER,
    platforms: selected.map(summarizePlatform),
    primary,
    candidates,
    recommendation: best
      ? {
          handle: best.candidate.handle,
          reason:
            `Available on ${best.availableCount} of ${selected.length} platforms` +
            (best.takenCount ? `, taken on ${best.takenCount}` : '') +
            (best.uncertainCount ? `, unconfirmed on ${best.uncertainCount}` : '') +
            '. Unconfirmed platforms must be verified manually.',
        }
      : null,
  };
}
