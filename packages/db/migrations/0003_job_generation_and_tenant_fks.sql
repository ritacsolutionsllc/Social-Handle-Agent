-- 1) Attempt generation for account-creation jobs.
--    Every worker/user update is a compare-and-set on (status, generation). Cancel and
--    retry bump the generation, so a worker still finishing a cancelled attempt can
--    never overwrite the retried one.
--    Added in two steps (nullable with default, then NOT NULL) to keep the change explicit.
alter table account_creation_jobs add column generation integer default 0;
update account_creation_jobs set generation = 0 where generation is null;
alter table account_creation_jobs alter column generation set not null;

-- 2) Tenant-scoped foreign keys.
--    The original FKs only prove a parent row exists; RLS checks each row's own
--    workspace_id. These composite FKs additionally guarantee that a child row can only
--    reference parents in the SAME workspace (defence in depth below the app layer).
--    Pre-launch tables are tiny, so the backing unique constraints are built inline.
alter table users add constraint users_id_workspace_uniq unique (id, workspace_id);
alter table handle_checks add constraint handle_checks_id_workspace_uniq unique (id, workspace_id);
alter table account_creation_jobs add constraint account_creation_jobs_id_workspace_uniq unique (id, workspace_id);

alter table handle_checks
  add constraint handle_checks_creator_same_ws foreign key (created_by, workspace_id) references users (id, workspace_id);
alter table handle_check_results
  add constraint handle_check_results_check_same_ws foreign key (handle_check_id, workspace_id) references handle_checks (id, workspace_id) on delete cascade;
alter table account_creation_jobs
  add constraint account_creation_jobs_check_same_ws foreign key (check_id, workspace_id) references handle_checks (id, workspace_id),
  add constraint account_creation_jobs_requester_same_ws foreign key (requested_by, workspace_id) references users (id, workspace_id);
alter table account_creation_job_events
  add constraint account_creation_job_events_job_same_ws foreign key (job_id, workspace_id) references account_creation_jobs (id, workspace_id) on delete cascade,
  add constraint account_creation_job_events_actor_same_ws foreign key (actor_user_id, workspace_id) references users (id, workspace_id);
alter table audit_events
  add constraint audit_events_actor_same_ws foreign key (actor_user_id, workspace_id) references users (id, workspace_id);
alter table platform_credentials
  add constraint platform_credentials_creator_same_ws foreign key (created_by, workspace_id) references users (id, workspace_id);
