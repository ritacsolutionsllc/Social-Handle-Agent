import type { AvailabilityResult, PlatformConfig, ProviderMode } from '@sha/core';

export interface CheckOptions {
  signal: AbortSignal;
}

/** One adapter per platform. Adapters must never throw for expected upstream behaviour. */
export interface AvailabilityAdapter {
  readonly key: string;
  readonly mode: ProviderMode;
  check(handle: string, platform: PlatformConfig, opts: CheckOptions): Promise<AvailabilityResult>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Read-only view of server-side credentials. Values never leave the server. */
export type CredentialSource = (name: string) => string | undefined;

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export const noopLogger: Logger = { info() {}, warn() {}, error() {} };

export interface LiveAdapterDeps {
  fetch: FetchLike;
  credentials: CredentialSource;
  now: () => Date;
  userAgent: string;
  robots: { isAllowed(url: string, signal: AbortSignal): Promise<boolean> };
}
