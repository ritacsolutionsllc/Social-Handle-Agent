import { describe, expect, it } from 'vitest';
import { generateCandidates, tokenize } from '../src';

const now = new Date('2026-10-14T00:00:00Z');

describe('tokenize', () => {
  it('drops corporate noise words', () => {
    expect(tokenize('Acme Robotics, Inc.')).toEqual(['acme', 'robotics']);
    expect(tokenize('The Widget Company LLC')).toEqual(['widget']);
  });
});

describe('generateCandidates', () => {
  it('uses the requested handle as primary', () => {
    const c = generateCandidates({ input: 'Acme Robotics', requestedHandle: '@AcmeRobotics', now });
    expect(c[0]).toMatchObject({ handle: 'acmerobotics', kind: 'primary' });
  });
  it('derives the primary from a company name', () => {
    expect(generateCandidates({ input: 'Acme Robotics Inc', now })[0]!.handle).toBe('acmerobotics');
  });
  it('treats a single @token as a handle', () => {
    expect(generateCandidates({ input: '@acme_brand', now })[0]!.handle).toBe('acme_brand');
  });
  it('produces the documented alternative strategies, at most 10, deduplicated', () => {
    const c = generateCandidates({ input: 'Acme Robotics', now });
    const handles = c.map((x) => x.handle);
    expect(c.length).toBeLessThanOrEqual(11);
    expect(new Set(handles).size).toBe(handles.length);
    expect(handles).toEqual(expect.arrayContaining(['acme_robotics', 'acmeroboticshq', 'acmeroboticsai', 'acmeroboticslabs', 'acmeroboticsco']));
  });
  it('ranks separator variants before suffixes and the year last', () => {
    const c = generateCandidates({ input: 'Acme Robotics', maxAlternatives: 20, now });
    expect(c[1]!.kind).toBe('separator');
    expect(c.at(-1)).toMatchObject({ handle: 'acmerobotics2026', kind: 'year' });
  });
  it('skips separator variants for single-word brands', () => {
    expect(generateCandidates({ input: 'Acme', now }).some((x) => x.kind === 'separator')).toBe(false);
  });
  it('returns nothing for input without usable characters', () => {
    expect(generateCandidates({ input: '!!!', now })).toEqual([]);
  });
});

describe('generateCandidates guards', () => {
  it('rejects primaries without letters or digits', () => {
    expect(generateCandidates({ input: '...', now })).toEqual([]);
    expect(generateCandidates({ input: 'Acme', requestedHandle: '._-', now })).toEqual([]);
  });
});
