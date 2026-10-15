import type { Logger } from '@sha/platforms';

const SENSITIVE = /pass(word)?|secret|token|cookie|authorization|api[_-]?key|verification[_-]?code|otp|credential/i;

/** Recursively redact sensitive keys so secrets never reach logs. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth > 6) return '[TRUNCATED]'; // never emit an unredacted deep subtree
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE.test(k) ? '[REDACTED]' : redact(v, depth + 1)]));
}

/** Structured JSON logger with request/job correlation fields. */
export function createLogger(base: Record<string, unknown> = {}, write: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): Logger & { child(fields: Record<string, unknown>): Logger } {
  const emit = (level: string, msg: string, fields?: Record<string, unknown>) =>
    write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(redact({ ...base, ...fields }) as object) }));
  return {
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (fields) => createLogger({ ...base, ...fields }, write),
  };
}
