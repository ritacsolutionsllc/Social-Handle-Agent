# CLAUDE.md — Social Handle Agent

Guidance for Claude Code (and humans) working in this repo. Keep it current when commands change.

## Package manager

**npm workspaces** (`package-lock.json` is committed). Do not introduce pnpm/yarn lockfiles.

## Exact commands

```bash
# One-time setup
npm ci                                   # install from lockfile
cp .env.example .env                     # local-only values; .env is git-ignored
npm run db:setup                         # = db:bootstrap + db:migrate + db:seed (local Postgres)
npx tsx packages/db/src/cli/migrate.ts --test && npx tsx packages/db/src/cli/seed.ts --test   # test DB

# Develop
npm run dev                              # Next.js on http://localhost:3000 (mock provider by default)
npm run worker                           # only when QUEUE_DRIVER=bullmq (needs REDIS_URL)

# Verify (run all three before committing)
npm run typecheck                        # tsc for packages + apps/web (no secrets needed)
npm test                                 # Vitest unit tests; DB/Redis integration tests auto-skip without TEST_* URLs
npm run build                            # production build; forces NODE_ENV=production, needs no secrets

# End-to-end (Playwright, mock provider, never contacts platforms)
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npm run test:e2e   # cloud env: preinstalled Chromium
```

Cloud environment notes:
- Start services if they are down: `service postgresql start && redis-server --daemonize yes`.
- The env sets `NODE_ENV=development` globally; `npm run build`/`start` override it to `production` (Next requires that).
- Do not run `playwright install`; use the preinstalled Chromium via `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

## Non-negotiable rules

1. **Never create real social accounts** in development or tests. Automated tests use `MockCreationAdapter`;
   the only production creation adapter is `GuidedManualCreationAdapter`, which contacts no platform.
2. **Never bypass captchas, phone/email verification, or anti-abuse controls.** No signup automation.
3. **Mock vs live are separate registries** (`packages/platforms/src/registry.ts`). A live adapter must never
   fall back to mock results; unsupported/unconfigured checks return `unknown` with a `reason`.
4. **`ACCOUNT_CREATION_ENABLED` is enforced server-side** in `CreationService.createJobs`/`retry` and again in
   `processCreationJob`. Credentials being present never authorizes registration. Per-platform confirmation
   (`CreationJobsRequestSchema`) is always required, even when enabled.
5. **Conservative availability:** `unknown` is never shown or ranked as available; a missing profile is never
   high-confidence "available"; every result records source/method, timestamp, evidence and confidence.
   The chosen handle is re-checked (cache bypass) before jobs are created and again when each job runs.
6. **No production migrations or deploys without explicit approval.** DB CLIs refuse `APP_ENV=production`
   unless `--confirm-production` is passed.
7. Secrets live only in server env vars. Never log tokens/passwords/cookies/codes (`redact()` in services logger).

## Layout

```
packages/core       domain: platform catalog, normalization, candidates, ranking, job state machine, Zod schemas, settings, ports
packages/platforms  availability adapters (mock + live), robots.txt, cache, AvailabilityChecker (concurrency/retry/cache)
packages/db         SQL migrations (schema + RLS + grants), Drizzle schema, repositories, credential vault, CLIs
packages/services   CheckService, CreationService, job processor, creation adapters, report builder, logger
packages/queue      Inline/BullMQ dispatchers, BullMQ worker, createRuntime() composition root
apps/web            Next.js App Router UI + thin API route handlers (auth, CSRF, rate limiting in src/server/http.ts)
```

Business logic belongs in `packages/services`/`core`, not in React components or route handlers.

## Conventions

- TypeScript strict, ESM only, no `any`. Zod schemas in `packages/core/src/api-schemas.ts` are the source of truth for input.
- Migrations are forward-only SQL files `packages/db/migrations/NNNN_name.sql`; never edit an applied file (checksum enforced).
  New indexes on populated tables should use `CREATE INDEX CONCURRENTLY` in their own migration.
- Every workspace table needs `workspace_id`, an RLS policy, and an entry in the isolation integration test.
- Avoid the literal word `f-o-r-m-a-t` in shell commands in this environment (a local hook blocks it); write SQL via files.
