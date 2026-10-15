import type { Separator, UsernameRules } from '../platforms';

/** Maximum raw input we accept anywhere. Protects regexes and storage. */
export const MAX_INPUT_LENGTH = 100;

const SEPARATORS: readonly Separator[] = ['_', '.', '-'];
const escape = (s: string) => s.replace(/[-.\\^$*+?()[\]{}|/]/g, '\\$&');

export interface NormalizedHandle {
  handle: string;
  valid: boolean;
  /** True when the platform rules forced a change from the canonical candidate. */
  modified: boolean;
  issues: string[];
}

/**
 * Platform-agnostic canonical form: lowercase ASCII, separators collapsed.
 * Unicode is folded (é → e) and anything else is dropped.
 */
export function canonicalize(raw: string): string {
  return raw
    .slice(0, MAX_INPUT_LENGTH)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/^@+/, '')
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9_.-]/g, '')
    .replace(/([_.-])[_.-]+/g, '$1');
}

/**
 * Adapt a canonical candidate to one platform's username rules. Never invents
 * characters: disallowed separators are removed rather than substituted, so the
 * result stays recognisable as the same brand.
 */
export function normalizeForPlatform(candidate: string, rules: UsernameRules): NormalizedHandle {
  const issues: string[] = [];
  const canonical = canonicalize(candidate);
  let h = rules.caseSensitive ? candidate.trim().replace(/^@+/, '') : canonical;

  const disallowedSeps = SEPARATORS.filter((s) => !rules.separators.includes(s));
  if (disallowedSeps.length > 0) {
    const re = new RegExp(`[${disallowedSeps.map(escape).join('')}]`, 'g');
    if (re.test(h)) issues.push(`removed separators not allowed: ${disallowedSeps.join(' ')}`);
    h = h.replace(re, '');
  }

  const allowed = new RegExp(`[^${rules.baseCharClass}${rules.separators.map(escape).join('')}]`, 'g');
  h = h.replace(allowed, '');

  if (rules.noConsecutiveSeparators && rules.separators.length > 0) {
    const sepClass = `[${rules.separators.map(escape).join('')}]`;
    h = h.replace(new RegExp(`(${sepClass})${sepClass}+`, 'g'), '$1');
  }

  const trimEdges = () => {
    if (rules.separators.length === 0) return;
    const sepClass = `[${rules.separators.map(escape).join('')}]`;
    if (rules.noLeadingSeparator) h = h.replace(new RegExp(`^${sepClass}+`), '');
    if (rules.noTrailingSeparator) h = h.replace(new RegExp(`${sepClass}+$`), '');
  };
  trimEdges();

  if (rules.mustStartWithLetter) {
    const stripped = h.replace(/^[^a-z]+/, '');
    if (stripped !== h) issues.push('must start with a letter');
    h = stripped;
  }

  if (h.length > rules.maxLength) {
    issues.push(`truncated to ${rules.maxLength} characters`);
    h = h.slice(0, rules.maxLength);
    trimEdges();
  }

  const valid = h.length >= rules.minLength && h.length <= rules.maxLength;
  if (h.length < rules.minLength) issues.push(`shorter than minimum length ${rules.minLength}`);

  return { handle: h, valid, modified: h !== canonical, issues };
}

/** Strict validation of an already-normalized handle (used on API input). */
export function isValidForPlatform(handle: string, rules: UsernameRules): boolean {
  const n = normalizeForPlatform(handle, rules);
  return n.valid && n.handle === (rules.caseSensitive ? handle : handle.toLowerCase());
}
