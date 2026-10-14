import { z } from 'zod';

export const AvailabilityStatusSchema = z.enum(['available', 'taken', 'unknown', 'rate_limited', 'error']);
export type AvailabilityStatus = z.infer<typeof AvailabilityStatusSchema>;

export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

/** Why a result is not definitive. Lets the UI explain `unknown` honestly. */
export const ResultReasonSchema = z.enum([
  'missing_credentials',
  'unsupported',
  'robots_disallowed',
  'bot_protection',
  'ambiguous_response',
  'invalid_for_platform',
  'derived_unknown',
  'timeout',
  'upstream_error',
]);
export type ResultReason = z.infer<typeof ResultReasonSchema>;

export const ProviderModeSchema = z.enum(['mock', 'live']);
export type ProviderMode = z.infer<typeof ProviderModeSchema>;

export interface AvailabilityResult {
  platform: string;
  handle: string;
  status: AvailabilityStatus;
  profileUrl?: string;
  confidence: Confidence;
  checkedAt: string;
  /** Check method, e.g. "youtube_data_api_v3", "http_profile_probe", "mock_fixture". */
  source: string;
  error?: string;
  reason?: ResultReason;
  /** Short, secret-free description of what was observed (status code, marker found…). */
  evidence?: string;
  /** True for mock-provider results. Simulated data must never be shown as a real check. */
  simulated: boolean;
  /** Present on rate_limited results when the upstream told us when to retry. */
  retryAfterMs?: number;
}

/**
 * Conservative interpretation used for ranking and UI copy. Only `available`
 * counts as available; `unknown` is never rounded up. A check never reserves a handle.
 */
export function availabilityWeight(r: Pick<AvailabilityResult, 'status' | 'confidence'>): number {
  if (r.status !== 'available') return 0;
  return r.confidence === 'high' ? 1 : r.confidence === 'medium' ? 0.8 : 0.5;
}

export const AVAILABILITY_DISCLAIMER =
  'Availability checks are point-in-time observations. They do not reserve a handle, and a missing public profile does not prove a handle can be registered.';
