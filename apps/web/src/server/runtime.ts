import 'server-only';
import { createRuntime, type Runtime } from '@sha/queue';

// One runtime per server process (survives dev hot-reloads via globalThis).
const g = globalThis as unknown as { __shaRuntime?: Runtime };

export function runtime(): Runtime {
  g.__shaRuntime ??= createRuntime(process.env);
  return g.__shaRuntime;
}
