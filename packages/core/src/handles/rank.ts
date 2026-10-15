import { availabilityWeight, type AvailabilityResult } from '../availability';
import type { Candidate } from './candidates';

export interface RankedCandidate {
  candidate: Candidate;
  availableCount: number;
  takenCount: number;
  uncertainCount: number;
  /** Confidence-weighted availability, used as tie-break inside availableCount. */
  weightedAvailability: number;
  length: number;
  digitCount: number;
  symbolCount: number;
  results: AvailabilityResult[];
}

/**
 * Rank by (1) platforms where the same handle is available, (2) shorter,
 * (3) fewer digits/symbols, (4) brand relevance. `unknown` never counts as available.
 */
export function rankCandidates(candidates: Candidate[], resultsFor: (c: Candidate) => AvailabilityResult[]): RankedCandidate[] {
  const ranked = candidates.map((candidate): RankedCandidate => {
    const rs = resultsFor(candidate);
    return {
      candidate,
      availableCount: rs.filter((r) => r.status === 'available').length,
      takenCount: rs.filter((r) => r.status === 'taken').length,
      uncertainCount: rs.filter((r) => r.status !== 'available' && r.status !== 'taken').length,
      weightedAvailability: rs.reduce((s, r) => s + availabilityWeight(r), 0),
      length: candidate.handle.length,
      digitCount: (candidate.handle.match(/\d/g) ?? []).length,
      symbolCount: (candidate.handle.match(/[_.-]/g) ?? []).length,
      results: rs,
    };
  });

  return ranked.sort(
    (a, b) =>
      b.availableCount - a.availableCount ||
      b.weightedAvailability - a.weightedAvailability ||
      a.length - b.length ||
      a.digitCount - b.digitCount ||
      a.symbolCount - b.symbolCount ||
      b.candidate.relevance - a.candidate.relevance ||
      a.candidate.handle.localeCompare(b.candidate.handle),
  );
}

/** Best recommendation: top-ranked candidate with at least one confirmed-available platform. */
export function recommend(ranked: RankedCandidate[]): RankedCandidate | null {
  return ranked.find((r) => r.availableCount > 0) ?? null;
}
