import type { RateLimitPolicy } from '@sha/core';

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/** Combine a caller signal with a per-call timeout. */
export function withTimeout(signal: AbortSignal, ms: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(ms)]);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason ?? new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Exponential backoff with full jitter, capped. */
export function backoffDelay(attempt: number, policy: Pick<RateLimitPolicy, 'baseDelayMs' | 'maxDelayMs'>, rng: () => number = Math.random): number {
  const exp = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  return Math.round(rng() * exp);
}

export function parseRetryAfter(header: string | null, now: Date): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now.getTime());
}

/** Counting semaphore with abort support. */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly max: number) {}

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw signal.reason ?? new Error('aborted');
    if (this.active < this.max) {
      this.active++;
      return () => this.release();
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const i = this.waiters.indexOf(go);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(signal?.reason ?? new Error('aborted'));
      };
      const go = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(go);
    });
    // The permit was handed over by release() without decrementing `active`.
    return () => this.release();
  }

  private release() {
    const next = this.waiters.shift();
    if (next) next(); // hand the permit straight to the waiter; `active` is unchanged
    else this.active--;
  }
}

/** Read at most `maxBytes` of a response body as text. Avoids unbounded memory on hostile pages. */
export async function readCapped(res: Response, maxBytes = 512 * 1024): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, maxBytes));
}
