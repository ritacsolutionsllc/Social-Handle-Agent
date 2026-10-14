import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// E2E runs against the production build (`next start`) in MOCK mode. It never
// contacts social platforms and never creates real accounts.
const rootEnv = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('E2E needs TEST_DATABASE_URL (or DATABASE_URL); run `npm run db:setup` first.');

const serverEnv = (creationEnabled: boolean): Record<string, string> => ({
  NODE_ENV: 'production',
  APP_ENV: 'test',
  AUTH_MODE: 'dev',
  AVAILABILITY_PROVIDER_MODE: 'mock',
  ACCOUNT_CREATION_ENABLED: String(creationEnabled),
  QUEUE_DRIVER: 'inline',
  CACHE_DRIVER: 'memory',
  DATABASE_URL: databaseUrl,
  SESSION_SECRET: 'e2e-only-session-secret-not-for-real-use-000000',
});

// Optional: point at a preinstalled Chromium when its revision differs from this Playwright version.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 45_000,
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure', launchOptions: executablePath ? { executablePath } : {} },
  projects: [
    { name: 'creation-disabled', testMatch: /disabled\.spec\.ts/, use: { baseURL: 'http://localhost:3100' } },
    { name: 'creation-enabled', testMatch: /enabled\.spec\.ts/, use: { baseURL: 'http://localhost:3101' } },
  ],
  webServer: [
    { command: 'npx next start -p 3100', url: 'http://localhost:3100/api/health', env: serverEnv(false), reuseExistingServer: false, timeout: 60_000 },
    { command: 'npx next start -p 3101', url: 'http://localhost:3101/api/health', env: serverEnv(true), reuseExistingServer: false, timeout: 60_000 },
  ],
});
