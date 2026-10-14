-- Row-level security and least-privilege grants.
-- Requires the NOLOGIN role `sha_app` (created by `npm run db:bootstrap`).
-- The app sets `app.workspace_id` per transaction with set_config(..., true).
-- RLS is intentionally not FORCEd: only the migration/owner role bypasses it,
-- and that role is never used by the application at runtime.

create schema if not exists app;

create or replace function app.current_workspace_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.workspace_id', true), '')::uuid
$$;

alter table workspaces enable row level security;
create policy workspace_self on workspaces
  using (id = app.current_workspace_id())
  with check (id = app.current_workspace_id());

alter table users enable row level security;
create policy workspace_isolation on users
  using (workspace_id = app.current_workspace_id()) with check (workspace_id = app.current_workspace_id());

alter table handle_checks enable row level security;
create policy workspace_isolation on handle_checks
  using (workspace_id = app.current_workspace_id()) with check (workspace_id = app.current_workspace_id());

alter table handle_check_results enable row level security;
create policy workspace_isolation on handle_check_results
  using (workspace_id = app.current_workspace_id()) with check (workspace_id = app.current_workspace_id());

alter table availability_observations enable row level security;
create policy workspace_isolation on availability_observations
  using (workspace_id = app.current_workspace_id()) with check (workspace_id = app.current_workspace_id());

alter table account_creation_jobs enable row level security;
create policy workspace_isolation on account_creation_jobs
  using (workspace_id = app.current_workspace_id()) with check (workspace_id = app.current_workspace_id());

alter table account_creation_job_events enable row level security;
create policy workspace_isolation on account_creation_job_events
  using (workspace_id = app.current_workspace_id()) with check (workspace_id = app.current_workspace_id());

alter table audit_events enable row level security;
create policy workspace_isolation on audit_events
  using (workspace_id = app.current_workspace_id()) with check (workspace_id = app.current_workspace_id());

alter table platform_credentials enable row level security;
create policy workspace_isolation on platform_credentials
  using (workspace_id = app.current_workspace_id()) with check (workspace_id = app.current_workspace_id());

-- Platform catalog is global and read-only for the app.
alter table platforms enable row level security;
create policy platforms_read on platforms for select using (true);

-- First login: create workspace + owner user. SECURITY DEFINER so it can look
-- up an email across workspaces; it returns only the caller's own identity.
create or replace function app.provision_user(p_email text)
returns table (user_id uuid, workspace_id uuid, role text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(trim(p_email));
  v_wid uuid;
  v_uid uuid;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'invalid email';
  end if;
  return query select u.id, u.workspace_id, u.role from users u where u.email = v_email;
  if found then return; end if;

  insert into workspaces(name) values (split_part(v_email, '@', 1) || '''s workspace') returning id into v_wid;
  insert into users(workspace_id, email, role) values (v_wid, v_email, 'owner')
    on conflict (email) do nothing returning id into v_uid;
  if v_uid is null then
    -- Lost a race with a concurrent first login; discard our workspace.
    delete from workspaces w where w.id = v_wid;
    return query select u.id, u.workspace_id, u.role from users u where u.email = v_email;
    return;
  end if;
  insert into audit_events(workspace_id, actor_user_id, action, entity_type, entity_id)
    values (v_wid, v_uid, 'user.provisioned', 'user', v_uid);
  return query select v_uid, v_wid, 'owner'::text;
end $$;

revoke all on function app.provision_user(text) from public;

grant usage on schema public, app to sha_app;
grant execute on function app.current_workspace_id() to sha_app;
grant execute on function app.provision_user(text) to sha_app;

grant select on platforms to sha_app;
grant select on workspaces, users to sha_app;
grant select, insert on handle_checks to sha_app;
grant select, insert, update on handle_check_results to sha_app;
grant select, insert on availability_observations to sha_app;
grant select, insert, update on account_creation_jobs to sha_app;
grant select, insert on account_creation_job_events to sha_app;
grant select, insert on audit_events to sha_app;           -- append-only
grant select, insert, delete on platform_credentials to sha_app;
