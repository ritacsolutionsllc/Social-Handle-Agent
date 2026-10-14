import { z } from 'zod';
import { DomainError } from './errors';

export const JobStatusSchema = z.enum(['queued', 'running', 'awaiting_verification', 'succeeded', 'failed', 'cancelled']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: ['running', 'cancelled', 'failed'],
  running: ['awaiting_verification', 'succeeded', 'failed', 'queued', 'cancelled'],
  awaiting_verification: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: ['queued'],
  cancelled: ['queued'],
};

export const TERMINAL_STATUSES: readonly JobStatus[] = ['succeeded', 'failed', 'cancelled'];

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) {
    throw new DomainError('invalid_transition', `Cannot move a job from "${from}" to "${to}".`, 409);
  }
}

export const isCancellable = (s: JobStatus) => canTransition(s, 'cancelled');
export const isRetryable = (s: JobStatus) => s === 'failed' || s === 'cancelled';

/** Instructions shown to the user when a job needs a human. Never contains secrets. */
export interface NextAction {
  type: 'manual_registration';
  registrationUrl: string;
  steps: string[];
  prefill: { handle: string; email: string };
  entityDescription: string;
  warning?: string;
}
