import { describe, expect, it } from 'vitest';
import { canonicalize, normalizeForPlatform, isValidForPlatform, PLATFORM_CATALOG, type UsernameRules } from '../src';

const rulesOf = (slug: string): UsernameRules => PLATFORM_CATALOG.find((p) => p.slug === slug)!.usernameRules;

describe('canonicalize', () => {
  it('lowercases, strips @, whitespace and invalid characters', () => {
    expect(canonicalize('  @AcmeBrand ')).toBe('acmebrand');
    expect(canonicalize('Acme Robotics!')).toBe('acmerobotics');
  });
  it('folds accents and collapses repeated separators', () => {
    expect(canonicalize('Café__Déjà..vu')).toBe('cafe_deja.vu');
  });
  it('bounds input length', () => {
    expect(canonicalize('a'.repeat(500)).length).toBeLessThanOrEqual(100);
  });
});

describe('normalizeForPlatform', () => {
  it('preserves a valid requested handle unchanged', () => {
    const r = normalizeForPlatform('acmerobotics', rulesOf('x'));
    expect(r).toMatchObject({ handle: 'acmerobotics', valid: true, modified: false });
  });
  it('removes separators the platform does not allow', () => {
    expect(normalizeForPlatform('acme.robotics', rulesOf('x')).handle).toBe('acmerobotics');
    expect(normalizeForPlatform('acme.robotics', rulesOf('instagram')).handle).toBe('acme.robotics');
    expect(normalizeForPlatform('acme_robotics', rulesOf('linkedin')).handle).toBe('acmerobotics');
    expect(normalizeForPlatform('acme-robotics', rulesOf('linkedin')).handle).toBe('acme-robotics');
  });
  it('truncates to max length and re-trims trailing separators', () => {
    const r = normalizeForPlatform('acmeroboticsint_ernational', rulesOf('x'));
    expect(r.handle).toBe('acmeroboticsint');
    expect(r.handle.length).toBe(15);
    expect(r.issues.join()).toMatch(/truncated/);
  });
  it('flags handles below minimum length as invalid', () => {
    const r = normalizeForPlatform('abc', rulesOf('x'));
    expect(r.valid).toBe(false);
  });
  it('enforces must-start-with-letter', () => {
    expect(normalizeForPlatform('9lives', rulesOf('snapchat')).handle).toBe('lives');
  });
  it('strips leading/trailing separators where required', () => {
    expect(normalizeForPlatform('_acme_', rulesOf('instagram')).handle).toBe('acme');
  });
  it('validates exact handles', () => {
    expect(isValidForPlatform('acme_robotics', rulesOf('x'))).toBe(true);
    expect(isValidForPlatform('acme.robotics', rulesOf('x'))).toBe(false);
  });
});
