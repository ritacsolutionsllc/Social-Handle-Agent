import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Load the repo-root .env (if present) for CLI scripts. Never required. */
export function loadDotEnv(): void {
  const p = resolve(process.cwd(), '.env');
  if (existsSync(p)) process.loadEnvFile(p);
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required environment variable ${name}. See .env.example.`);
    process.exit(1);
  }
  return v;
}

/** Guard: production database operations require an explicit flag. */
export function guardProduction(action: string): void {
  const prod = process.env.APP_ENV ? process.env.APP_ENV === 'production' : process.env.NODE_ENV === 'production';
  if (prod && !process.argv.includes('--confirm-production')) {
    console.error(`Refusing to ${action} with APP_ENV/NODE_ENV=production. Re-run with --confirm-production after explicit approval.`);
    process.exit(1);
  }
}
