export type ErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'csrf_failed'
  | 'not_found'
  | 'rate_limited'
  | 'invalid_transition'
  | 'conflict'
  | 'feature_disabled'
  | 'confirmation_required'
  | 'handle_unavailable'
  | 'internal_error';

/** An expected failure with a safe, user-facing message and an HTTP status. */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const notFound = (what: string) => new DomainError('not_found', `${what} not found.`, 404);
