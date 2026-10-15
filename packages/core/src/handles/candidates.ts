import { canonicalize, MAX_INPUT_LENGTH } from './normalize';

export const ALTERNATIVE_SUFFIXES = ['hq', 'official', 'app', 'co', 'labs', 'ai', 'team', 'group'] as const;

/** Legal-entity words that never belong in a handle. */
const CORPORATE_NOISE = new Set([
  'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'gmbh', 'plc', 'sa', 'srl', 'pty', 'company', 'the',
]);

export type CandidateKind = 'primary' | 'suffix' | 'separator' | 'year';

export interface Candidate {
  handle: string;
  kind: CandidateKind;
  /** 0..1, higher = closer to the brand as entered. */
  relevance: number;
}

export interface CandidateInput {
  input: string;
  requestedHandle?: string | undefined;
  maxAlternatives?: number;
  now?: Date;
}

/** Split free text ("Acme Robotics, Inc.") into meaningful lowercase tokens. */
export function tokenize(input: string): string[] {
  return input
    .slice(0, MAX_INPUT_LENGTH)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !CORPORATE_NOISE.has(t));
}

export function looksLikeHandle(input: string): boolean {
  const t = input.trim();
  return t.startsWith('@') || /^[A-Za-z0-9_.-]+$/.test(t);
}

/**
 * Produce a primary candidate plus up to `maxAlternatives` fallbacks, in a
 * deterministic, brand-preserving order. Platform-specific shaping happens later.
 */
export function generateCandidates({ input, requestedHandle, maxAlternatives = 10, now = new Date() }: CandidateInput): Candidate[] {
  const tokens = looksLikeHandle(input) && !/\s/.test(input.trim()) ? [canonicalize(input)] : tokenize(input);
  const joined = tokens.join('');
  const requested = requestedHandle ? canonicalize(requestedHandle) : '';
  const primary = requested || (looksLikeHandle(input) && !/\s/.test(input.trim()) ? canonicalize(input) : joined);
  if (!/[a-z0-9]/.test(primary)) return []; // e.g. '...' is not a brand

  // Base for alternatives: separators stripped so "acme_robotics" + "hq" stays clean.
  const base = primary.replace(/[_.-]/g, '');
  const out: Candidate[] = [{ handle: primary, kind: 'primary', relevance: 1 }];
  const seen = new Set([primary]);
  const push = (c: Candidate) => {
    if (c.handle.length === 0 || seen.has(c.handle)) return;
    seen.add(c.handle);
    out.push(c);
  };

  // Separator variants only make sense for multi-word brands.
  const words = tokens.length > 1 ? tokens : [];
  for (const suffix of ALTERNATIVE_SUFFIXES) {
    push({ handle: `${base}${suffix}`, kind: 'suffix', relevance: 0.8 });
  }
  if (words.length > 1) {
    push({ handle: words.join('_'), kind: 'separator', relevance: 0.9 });
    push({ handle: words.join('.'), kind: 'separator', relevance: 0.85 });
    push({ handle: words.join('-'), kind: 'separator', relevance: 0.85 });
  }
  push({ handle: `${base}${now.getUTCFullYear()}`, kind: 'year', relevance: 0.5 });

  // Separator variants are more brand-faithful than suffixes; order by relevance, stable.
  const [first, ...rest] = out;
  const ordered = rest
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.relevance - a.c.relevance || a.i - b.i)
    .map((x) => x.c);
  return [first!, ...ordered.slice(0, maxAlternatives)];
}
