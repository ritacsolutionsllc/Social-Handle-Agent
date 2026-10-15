# Social Handle Agent

Check whether a brand's handle is available across the top 10 social platforms, get ranked alternatives, and plan account registration with explicit, per-platform human approval.

> **Safety model in one paragraph.** Availability checks are point-in-time observations: they **do not reserve a handle**, and a missing public profile does not prove a handle is registrable. `unknown` is never treated as available. No platform here offers an account-creation API, so every platform uses **guided manual registration**: the app prepares the plan and the human signs up (including captcha/phone/email verification) on the platform. The app never automates signup, never bypasses anti-abuse controls, and never stores passwords or verification codes.

## Quick start (mock mode, no third-party credentials)

```bash
npm ci
cp .env.example .env      # then replace each CHANGE_ME_* value (e.g. `openssl rand -hex 16`)
# Postgres 16 + Redis: either local services or `docker compose up -d` (reads POSTGRES_PASSWORD from .env)
npm run db:setup          # creates roles + DBs, applies migrations, seeds the platform catalog
npm run dev               # http://localhost:3000 — sign in with any email (dev auth)
```

Defaults: `AVAILABILITY_PROVIDER_MODE=mock`, `ACCOUNT_CREATION_ENABLED=false`. Mock results are deterministic fixtures, flagged `simulated: true`, and labelled **“Simulated data”** throughout the UI.

| Command | Purpose |
|---|---|
| `npm run typecheck` | Strict TypeScript for every package and the web app |
| `npm test` | Vitest unit tests (+ Postgres/Redis integration tests when `TEST_*` URLs are set) |
| `npm run build` | Production build (needs no secrets) |
| `npm run test:e2e` | Playwright against `next start` in mock mode (set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use a preinstalled Chromium) |
| `npm run db:migrate` / `db:seed` | Apply migrations / upsert platform catalog (`--test` targets the test DB) |
| `npm run worker` | BullMQ worker (only with `QUEUE_DRIVER=bullmq`) |

Test database: `npx tsx packages/db/src/cli/migrate.ts --test && npx tsx packages/db/src/cli/seed.ts --test`.

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request and on pushes to `main`: `npm ci` → typecheck → database bootstrap/migrate/seed against a Postgres 16 service → Vitest (including the RLS-isolation and BullMQ integration tests, with a Redis 7 service) → production build → Playwright E2E. It uses the mock provider with account creation disabled, needs no repository secrets, generates a fresh database password per run, and uploads the Playwright report when a run fails.

## Environment variables

See [`.env.example`](.env.example) for every variable with explanations. Key ones:

| Variable | Default | Notes |
|---|---|---|
| `APP_ENV` | `production` if `NODE_ENV=production`, else `development` | Authoritative environment. Production refuses dev auth, mock provider, and weak `SESSION_SECRET`. |
| `AVAILABILITY_PROVIDER_MODE` | `mock` (non-prod) / `live` (prod) | Separate registries; live never falls back to mock. |
| `ACCOUNT_CREATION_ENABLED` | `false` | Server-enforced kill switch. When false: checks + plan previews only; job creation returns `403 feature_disabled` before anything is enqueued. |
| `AUTH_MODE` | `dev` | `dev` = email-only login (refused in production); `supabase` = magic link, token verified via JWKS. |
| `DATABASE_URL` | — | Least-privilege `sha_app` login role, subject to RLS. |
| `MIGRATION_DATABASE_URL` / `ADMIN_DATABASE_URL` | — | Owner/admin roles used only by CLIs, never by the app. |
| `QUEUE_DRIVER` / `CACHE_DRIVER` / `REDIS_URL` | `inline` / `memory` | Use `bullmq` + `redis` for durable jobs and shared cache/rate limits. |
| `SESSION_SECRET` | random per process (dev only) | Required (32+ chars) in staging and production. |
| `TRUSTED_PROXY_HOPS` | `0` | Number of reverse proxies in front of the app; the client IP for rate limiting is read from that position in `X-Forwarded-For`. `0` ignores the (client-controlled) header. |
| Live adapter creds | unset | `X_BEARER_TOKEN`, `YOUTUBE_API_KEY`, `REDDIT_CLIENT_ID/SECRET/USER_AGENT`, `META_GRAPH_ACCESS_TOKEN` + `META_IG_BUSINESS_ACCOUNT_ID`. Server-only; never authorize registration. |

## Platforms: what is checked, how, and what is provisioned

| Platform | Entity checked | Live method | Best confidence | Provisioning |
|---|---|---|---|---|
| X / Twitter | Account username | API v2 user lookup (paid tier) | taken: high · available: **medium** (suspended/reserved look identical) | Guided manual |
| Instagram | Account username | Graph API Business Discovery | taken: high · **never “available”** (personal accounts invisible) | Guided manual |
| Facebook | **Page** username (vanity URL) | None permitted → always `unknown` | — | Guided manual (Page created from a personal profile) |
| TikTok | Account username | robots-gated profile probe (embedded data markers) | taken: medium · available: low | Guided manual |
| YouTube | **Channel** @handle (not the Google account) | Data API v3 `channels?forHandle`; else robots-gated `/@handle` probe | taken: high · available: medium (API) / low (probe) | Guided manual |
| LinkedIn | **Company Page** URL slug | None permitted → always `unknown` | — | Guided manual (Page created from a member profile) |
| Pinterest | Account username | robots-gated profile probe | taken: medium · available: low | Guided manual |
| Reddit | User account | Official `/api/username_available` (app-only OAuth) | high both ways | Guided manual (username is permanent) |
| Snapchat | Account username | robots-gated `/add/` probe | taken: medium · **never “available”** (private accounts invisible) | Guided manual |
| Threads | **Linked profile** (handle inherited from Instagram) | Derived from Instagram | taken: medium · otherwise `unknown` | Guided manual (claim Instagram first) |

Redirects, login walls, captchas, bot-protection pages and bare 404s are never treated as definitive. Every result stores method (`source`), timestamp, `evidence`, `confidence` and, for non-definitive results, a `reason` (`missing_credentials`, `unsupported`, `robots_disallowed`, `bot_protection`, …).

### Known limitations

- Probes are fragile by nature (markup changes, regional consent walls, bot protection); expect many `unknown`s in live mode without API credentials.
- Username rules in the catalog are best-effort summaries of platform help pages. They live in the `platforms` table so they can be corrected without a deploy; re-verify periodically.
- X API access requires a paid tier; YouTube API calls consume quota (rate-limit responses are surfaced as `rate_limited` and retried with backoff).
- `InlineDispatcher` is not durable (a restart drops in-flight work; jobs stay `queued` and can be retried). Use BullMQ in any shared environment.
- Rate limiting with `CACHE_DRIVER=memory` is per-process; use Redis when running more than one instance. If Redis becomes unavailable, limits fall back to per-process memory counters (logged as `ratelimit.store_unavailable`) rather than rejecting requests.
- Session role is captured at login (8h TTL); role changes take effect on next login.

## Architecture

```
apps/web (Next.js) ──► packages/services ──► packages/core (domain, ports, Zod)
   │  thin routes          │  CheckService / CreationService / job processor
   │  auth, CSRF, RL       ├──► packages/platforms (mock + live adapters, AvailabilityChecker)
   ▼                       └──► ports implemented by packages/db (Postgres + RLS)
packages/queue: createRuntime() composition root, Inline/BullMQ dispatchers, worker
```

- **Check flow:** normalize → primary + ≤10 alternatives → per-platform shaping → check primary on all platforms (bounded global + per-platform concurrency, 5-min cache keyed by mode/platform/handle, backoff with jitter on rate limits, overall deadline) → check alternatives only if needed → persist check, results, append-only observations and audit event in one transaction → ranked report.
- **Creation flow:** plan preview (always allowed) → kill switch → role check → per-platform confirmation + acknowledgement (Zod) → block taken/invalid platforms → fresh cache-bypassing recheck → jobs + audit in one transaction (partial unique index prevents duplicate active jobs) → enqueue after commit → worker re-checks the switch and the handle, then `GuidedManualCreationAdapter` moves the job to `awaiting_verification` with registration URL and copyable fields → user confirms → server re-verifies before `succeeded`.
- **Multi-tenancy:** every workspace table has `workspace_id` + RLS policy on `app.current_workspace_id()`, set per transaction via `set_config(..., true)`. The app role is non-superuser without `BYPASSRLS`; audit events are append-only by grant. Integration tests prove cross-workspace reads and writes fail.
- **Security:** HTTP-only SameSite session cookie (HS256 JWT), session-bound double-submit CSRF + Origin/Sec-Fetch-Site checks, per-IP/user/workspace rate limits, strict CSP and security headers, Zod on every input, typed error responses with request IDs, structured JSON logs with secret redaction, envelope-encrypted credential vault (AES-256-GCM DEK per secret, KEK from env; swap for KMS).

## API

| Method | Path | Notes |
|---|---|---|
| POST | `/api/check` | `{ input, requestedHandle?, platforms?, includeAlternatives? }` → report |
| GET | `/api/checks/:id` | Report (workspace-scoped) |
| POST | `/api/checks/:id/recheck` | `{ platform, handle }` — cache-bypassing recheck of one cell |
| POST | `/api/handles/suggestions` | Candidates + per-platform shaping, no network |
| POST | `/api/creation-plans` | Read-only plan preview (allowed when creation disabled) |
| POST | `/api/creation-jobs` | `{ checkId, handle, platforms, confirmedPlatforms, acknowledgedTerms: true }` — 403 when disabled |
| GET | `/api/creation-jobs` · `/api/creation-jobs/:id` | Jobs with audit trail |
| POST | `/api/creation-jobs/:id/cancel` · `/retry` · `/confirm` | State-machine transitions |
| GET | `/api/health`, `/api/me`, `/api/platforms` | |

Errors: `{ "error": { "code", "message", "details?" }, "requestId" }` with 400/401/403/404/409/413/429/500.

## Adding a platform

1. Add a `PlatformConfig` entry to `PLATFORM_CATALOG` (`packages/core/src/platforms.ts`) with rules, entity type, URLs, strategies, rate-limit policy and required credential names. Run `npm run db:seed`.
2. Implement a live adapter in `packages/platforms/src/adapters/live.ts` extending `LiveAdapter`. Return `unknown` + `reason` whenever the answer isn't definitive; set conservative confidence; never include URLs or tokens in errors.
3. Register it in `createLiveRegistry` (`packages/platforms/src/registry.ts`). The mock registry covers new keys automatically; add fixtures in `MOCK_FIXTURES` if tests need them.
4. Add adapter tests with `fakeFetch` (see `packages/platforms/test/adapters.test.ts`) covering taken, not-found, rate-limit, missing credentials and bot-protection paths.
5. Update the platform table in this README.

## Deploying (requires explicit approval)

Nothing here deploys automatically. For a real deployment: managed Postgres (Supabase works — run `db:bootstrap`'s role statements via SQL, then `db:migrate`), Redis, `APP_ENV=production`, `AUTH_MODE=supabase`, `AVAILABILITY_PROVIDER_MODE=live`, strong `SESSION_SECRET`, `QUEUE_DRIVER=bullmq`, `CACHE_DRIVER=redis`, and a separate `npm run worker` process. DB CLIs refuse production without `--confirm-production`.
