-- Social Handle Agent: core schema.
-- Runs as the schema OWNER (migration role). The application connects as a
-- separate least-privilege role (sha_app) that is subject to row-level security.

create table platforms (
  slug                  text primary key check (slug ~ '^[a-z0-9_]{1,32}$'),
  name                  text not null,
  enabled               boolean not null default true,
  sort_order            integer not null,
  adapter_key           text not null,
  entity_type           text not null check (entity_type in ('user_account','business_page','channel_handle','linked_profile')),
  entity_description    text not null,
  username_rules        jsonb not null,
  profile_url_template  text not null check (profile_url_template like '%{handle}%'),
  registration_url      text not null,
  availability_strategy text not null check (availability_strategy in ('official_api','http_profile_probe','derived','manual_only')),
  availability_notes    text not null,
  derived_from          text,
  creation_strategy     text not null check (creation_strategy in ('guided_manual','unsupported')),
  manual_steps          jsonb not null default '[]',
  rate_limit_policy     jsonb not null,
  required_credentials  jsonb not null default '[]',
  updated_at            timestamptz not null default now()
);

create table workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 200),
  created_at timestamptz not null default now()
);

create table users (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email        text not null unique check (email = lower(email) and length(email) <= 254),
  role         text not null default 'owner' check (role in ('owner','admin','member','viewer')),
  created_at   timestamptz not null default now()
);
create index users_workspace_idx on users(workspace_id);

create table handle_checks (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  created_by        uuid not null references users(id),
  original_input    text not null check (length(original_input) <= 100),
  requested_handle  text,
  normalized_handle text not null,
  provider_mode     text not null check (provider_mode in ('mock','live')),
  platforms         text[] not null,
  candidates        jsonb not null,
  created_at        timestamptz not null default now()
);
create index handle_checks_workspace_created_idx on handle_checks(workspace_id, created_at desc);

create table handle_check_results (
  id              uuid primary key default gen_random_uuid(),
  handle_check_id uuid not null references handle_checks(id) on delete cascade,
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  platform        text not null references platforms(slug),
  handle          text not null,
  status          text not null check (status in ('available','taken','unknown','rate_limited','error')),
  confidence      text not null check (confidence in ('high','medium','low')),
  profile_url     text,
  source          text not null,
  reason          text,
  evidence        text,
  error           text,
  simulated       boolean not null,
  checked_at      timestamptz not null,
  unique (handle_check_id, platform, handle)
);
create index handle_check_results_workspace_idx on handle_check_results(workspace_id);

-- Append-only history for auditing and trend analysis (rechecks never overwrite it).
create table availability_observations (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  platform     text not null references platforms(slug),
  handle       text not null,
  status       text not null,
  confidence   text not null,
  source       text not null,
  reason       text,
  evidence     text,
  simulated    boolean not null,
  checked_at   timestamptz not null
);
create index availability_observations_lookup_idx on availability_observations(platform, handle, checked_at desc);
create index availability_observations_workspace_idx on availability_observations(workspace_id);

create table account_creation_jobs (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  check_id          uuid not null references handle_checks(id),
  requested_by      uuid not null references users(id),
  platform          text not null references platforms(slug),
  handle            text not null,
  email             text not null,
  status            text not null check (status in ('queued','running','awaiting_verification','succeeded','failed','cancelled')),
  attempts          integer not null default 0 check (attempts >= 0),
  last_error        text,
  store_credentials boolean not null default false,
  next_action       jsonb,
  provider_mode     text not null check (provider_mode in ('mock','live')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index account_creation_jobs_workspace_idx on account_creation_jobs(workspace_id, created_at desc);
create index account_creation_jobs_check_idx on account_creation_jobs(check_id);
-- Idempotency: at most one active job per workspace/platform/handle.
create unique index account_creation_jobs_active_uniq on account_creation_jobs(workspace_id, platform, handle)
  where status in ('queued','running','awaiting_verification');

create table account_creation_job_events (
  id            bigint generated always as identity primary key,
  job_id        uuid not null references account_creation_jobs(id) on delete cascade,
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  from_status   text,
  to_status     text not null,
  message       text not null,
  actor_user_id uuid references users(id),
  created_at    timestamptz not null default now()
);
create index account_creation_job_events_job_idx on account_creation_job_events(job_id, id);

create table audit_events (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  actor_user_id uuid references users(id),
  action        text not null,
  entity_type   text not null,
  entity_id     uuid,
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index audit_events_workspace_created_idx on audit_events(workspace_id, created_at desc);

-- Envelope-encrypted platform credentials (reserved for future official OAuth
-- connections). Plaintext never touches the database.
create table platform_credentials (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  platform     text not null references platforms(slug),
  label        text not null,
  ciphertext   bytea not null,
  iv           bytea not null,
  auth_tag     bytea not null,
  wrapped_dek  bytea not null,
  key_version  integer not null,
  created_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  unique (workspace_id, platform, label)
);
