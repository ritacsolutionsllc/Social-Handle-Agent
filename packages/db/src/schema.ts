import { bigint, boolean, customType, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { NextAction, StoredCandidate, UsernameRules, RateLimitPolicy } from '@sha/core';

/**
 * Typed mirror of migrations/*.sql. The SQL files are authoritative (they also
 * define RLS policies, roles and functions that Drizzle cannot express);
 * test/db.integration.test.ts exercises every table through this schema.
 */

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const platforms = pgTable('platforms', {
  slug: text('slug').primaryKey(),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull(),
  sortOrder: integer('sort_order').notNull(),
  adapterKey: text('adapter_key').notNull(),
  entityType: text('entity_type').notNull(),
  entityDescription: text('entity_description').notNull(),
  usernameRules: jsonb('username_rules').$type<UsernameRules>().notNull(),
  profileUrlTemplate: text('profile_url_template').notNull(),
  registrationUrl: text('registration_url').notNull(),
  availabilityStrategy: text('availability_strategy').notNull(),
  availabilityNotes: text('availability_notes').notNull(),
  derivedFrom: text('derived_from'),
  creationStrategy: text('creation_strategy').notNull(),
  manualSteps: jsonb('manual_steps').$type<string[]>().notNull(),
  rateLimitPolicy: jsonb('rate_limit_policy').$type<RateLimitPolicy>().notNull(),
  requiredCredentials: jsonb('required_credentials').$type<string[]>().notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  email: text('email').notNull(),
  role: text('role').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const handleChecks = pgTable('handle_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  createdBy: uuid('created_by').notNull(),
  originalInput: text('original_input').notNull(),
  requestedHandle: text('requested_handle'),
  normalizedHandle: text('normalized_handle').notNull(),
  providerMode: text('provider_mode').notNull(),
  platforms: text('platforms').array().notNull(),
  candidates: jsonb('candidates').$type<StoredCandidate[]>().notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const handleCheckResults = pgTable('handle_check_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  handleCheckId: uuid('handle_check_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  platform: text('platform').notNull(),
  handle: text('handle').notNull(),
  status: text('status').notNull(),
  confidence: text('confidence').notNull(),
  profileUrl: text('profile_url'),
  source: text('source').notNull(),
  reason: text('reason'),
  evidence: text('evidence'),
  error: text('error'),
  simulated: boolean('simulated').notNull(),
  checkedAt: ts('checked_at').notNull(),
});

export const availabilityObservations = pgTable('availability_observations', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  workspaceId: uuid('workspace_id').notNull(),
  platform: text('platform').notNull(),
  handle: text('handle').notNull(),
  status: text('status').notNull(),
  confidence: text('confidence').notNull(),
  source: text('source').notNull(),
  reason: text('reason'),
  evidence: text('evidence'),
  simulated: boolean('simulated').notNull(),
  checkedAt: ts('checked_at').notNull(),
});

export const accountCreationJobs = pgTable('account_creation_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  checkId: uuid('check_id').notNull(),
  requestedBy: uuid('requested_by').notNull(),
  platform: text('platform').notNull(),
  handle: text('handle').notNull(),
  email: text('email').notNull(),
  status: text('status').notNull(),
  attempts: integer('attempts').notNull().default(0),
  generation: integer('generation').notNull().default(0),
  lastError: text('last_error'),
  storeCredentials: boolean('store_credentials').notNull().default(false),
  nextAction: jsonb('next_action').$type<NextAction | null>(),
  providerMode: text('provider_mode').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const accountCreationJobEvents = pgTable('account_creation_job_events', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  jobId: uuid('job_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  message: text('message').notNull(),
  actorUserId: uuid('actor_user_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  actorUserId: uuid('actor_user_id'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const platformCredentials = pgTable('platform_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  platform: text('platform').notNull(),
  label: text('label').notNull(),
  ciphertext: bytea('ciphertext').notNull(),
  iv: bytea('iv').notNull(),
  authTag: bytea('auth_tag').notNull(),
  wrappedDek: bytea('wrapped_dek').notNull(),
  keyVersion: integer('key_version').notNull(),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});
