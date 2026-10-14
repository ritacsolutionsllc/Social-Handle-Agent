import { describe, expect, it } from 'vitest';
import { rankCandidates, recommend, type AvailabilityResult, type Candidate } from '../src';

const res = (handle: string, platform: string, status: AvailabilityResult['status'], confidence: AvailabilityResult['confidence'] = 'high'): AvailabilityResult => ({
  platform, handle, status, confidence, checkedAt: '2026-01-01T00:00:00Z', source: 'test', simulated: true,
});
const cand = (handle: string, relevance = 0.8): Candidate => ({ handle, kind: 'suffix', relevance });

describe('rankCandidates', () => {
  it('prefers the handle available on the most platforms', () => {
    const cs = [cand('acmehq'), cand('acmeroboticsai')];
    const rs = [res('acmehq', 'x', 'available'), res('acmeroboticsai', 'x', 'available'), res('acmeroboticsai', 'reddit', 'available')];
    expect(rankCandidates(cs, (c) => rs.filter((r) => r.handle === c.handle))[0]!.candidate.handle).toBe('acmeroboticsai');
  });
  it('never counts unknown as available', () => {
    const cs = [cand('a1'), cand('b1')];
    const rs = [res('a1', 'x', 'unknown'), res('a1', 'y', 'unknown'), res('b1', 'x', 'available', 'low')];
    const ranked = rankCandidates(cs, (c) => rs.filter((r) => r.handle === c.handle));
    expect(ranked[0]!.candidate.handle).toBe('b1');
    expect(ranked[1]!.availableCount).toBe(0);
  });
  it('breaks ties by length, then digits/symbols, then relevance', () => {
    const cs = [cand('acme_co'), cand('acme2026'), cand('acmeco'), cand('acmeteam')];
    const rs = cs.map((c) => res(c.handle, 'x', 'available'));
    expect(rankCandidates(cs, (c) => rs.filter((r) => r.handle === c.handle)).map((r) => r.candidate.handle)).toEqual(['acmeco', 'acme_co', 'acmeteam', 'acme2026']);
  });
  it('recommend returns null when nothing is confirmed available', () => {
    const ranked = rankCandidates([cand('x1')], () => [res('x1', 'x', 'unknown')]);
    expect(recommend(ranked)).toBeNull();
  });
});
