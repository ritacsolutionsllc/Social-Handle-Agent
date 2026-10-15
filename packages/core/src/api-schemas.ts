import { z } from 'zod';
import { MAX_INPUT_LENGTH } from './handles/normalize';

/** Zod schemas are the single source of truth for external input. */

const PlatformSlug = z.string().regex(/^[a-z0-9_]{1,32}$/, 'invalid platform slug');
const HandleInput = z
  .string()
  .trim()
  .min(1)
  .max(110) // generated candidates can reach 100 chars of input + an 8-char suffix
  .regex(/^@?[A-Za-z0-9_.-]+$/, 'handles may only contain letters, numbers, "_", "." and "-"');
/** User-typed handle: canonicalize() keeps MAX_INPUT_LENGTH chars, so reject longer instead of truncating silently. */
const RequestedHandle = HandleInput.refine((s) => s.replace(/^@/, '').length <= MAX_INPUT_LENGTH, `handle must be at most ${MAX_INPUT_LENGTH} characters`);

const FreeText = z
  .string()
  .trim()
  .min(1, 'enter a company, brand or handle')
  .max(MAX_INPUT_LENGTH)
  .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), 'control characters are not allowed');

export const CheckRequestSchema = z.object({
  input: FreeText,
  requestedHandle: RequestedHandle.optional(),
  platforms: z.array(PlatformSlug).min(1).max(20).optional(),
  includeAlternatives: z.boolean().default(true),
});
export type CheckRequest = z.infer<typeof CheckRequestSchema>;

export const SuggestionsRequestSchema = z.object({
  input: FreeText,
  requestedHandle: RequestedHandle.optional(),
});

export const RecheckRequestSchema = z.object({
  platform: PlatformSlug,
  handle: HandleInput,
});

export const CreationPlanRequestSchema = z.object({
  checkId: z.uuid(),
  handle: HandleInput,
  platforms: z.array(PlatformSlug).min(1).max(20),
});
export type CreationPlanRequest = z.infer<typeof CreationPlanRequestSchema>;

export const CreationJobsRequestSchema = CreationPlanRequestSchema.extend({
  /** Must list every platform in `platforms`: explicit per-platform confirmation. */
  confirmedPlatforms: z.array(PlatformSlug).min(1).max(20),
  acknowledgedTerms: z.literal(true, { error: 'you must acknowledge verification and platform terms' }),
}).refine(
  (v) => v.platforms.every((p) => v.confirmedPlatforms.includes(p)) && v.confirmedPlatforms.every((p) => v.platforms.includes(p)),
  { message: 'every platform must be explicitly confirmed', path: ['confirmedPlatforms'] },
);
export type CreationJobsRequest = z.infer<typeof CreationJobsRequestSchema>;

export const IdParamSchema = z.object({ id: z.uuid() });

export const DevLoginSchema = z.object({ email: z.email().max(254) });
export const SupabaseSessionSchema = z.object({ accessToken: z.string().min(20).max(8192) });
