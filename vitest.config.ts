import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Integration tests read TEST_* URLs from the shell or a local .env; they skip when absent.
const dotenv = existsSync('.env')
  ? Object.fromEntries(
      readFileSync('.env', 'utf8')
        .split('\n')
        .map((l) => /^\s*(TEST_[A-Z_]+)\s*=\s*(\S+)/.exec(l))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => [m[1], m[2]]),
    )
  : {};

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/web/test/**/*.test.ts'],
    environment: 'node',
    // Unit tests must never need production secrets or network access.
    env: { ...dotenv, NODE_ENV: 'test', APP_ENV: 'test', AVAILABILITY_PROVIDER_MODE: 'mock', ACCOUNT_CREATION_ENABLED: 'false' },
    testTimeout: 15_000,
  },
});
