import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type postgres from 'postgres';
import { PLATFORM_CATALOG } from '@sha/core';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * Minimal forward-only migration runner. Each file runs in its own transaction
 * under an advisory lock; applied files are checksummed so edits are detected.
 */
export async function runMigrations(sql: postgres.Sql, log: (m: string) => void = console.log): Promise<string[]> {
  const applied: string[] = [];
  await sql`select pg_advisory_lock(727274)`;
  try {
    await sql`create table if not exists _migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now())`;
    const done = new Map((await sql<{ name: string; checksum: string }[]>`select name, checksum from _migrations`).map((r) => [r.name, r.checksum]));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
    for (const f of files) {
      const body = await readFile(join(MIGRATIONS_DIR, f), 'utf8');
      const checksum = createHash('sha256').update(body).digest('hex');
      const prev = done.get(f);
      if (prev) {
        if (prev !== checksum) throw new Error(`Migration ${f} was modified after being applied. Create a new migration instead.`);
        continue;
      }
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into _migrations (name, checksum) values (${f}, ${checksum})`;
      });
      log(`applied ${f}`);
      applied.push(f);
    }
  } finally {
    await sql`select pg_advisory_unlock(727274)`;
  }
  return applied;
}

/** Idempotent upsert of the platform catalog. Re-running restores config from code. */
export async function seedPlatforms(sql: postgres.Sql): Promise<number> {
  for (const p of PLATFORM_CATALOG) {
    await sql`
      insert into platforms (slug, name, enabled, sort_order, adapter_key, entity_type, entity_description, username_rules,
        profile_url_template, registration_url, availability_strategy, availability_notes, derived_from, creation_strategy,
        manual_steps, rate_limit_policy, required_credentials, updated_at)
      values (${p.slug}, ${p.name}, ${p.enabled}, ${p.sortOrder}, ${p.adapterKey}, ${p.entityType}, ${p.entityDescription},
        ${sql.json(p.usernameRules)}, ${p.profileUrlTemplate}, ${p.registrationUrl}, ${p.availabilityStrategy}, ${p.availabilityNotes},
        ${p.derivedFrom ?? null}, ${p.creationStrategy}, ${sql.json(p.manualSteps)}, ${sql.json(p.rateLimitPolicy)},
        ${sql.json(p.requiredCredentials)}, now())
      on conflict (slug) do update set
        name = excluded.name, sort_order = excluded.sort_order, adapter_key = excluded.adapter_key,
        entity_type = excluded.entity_type, entity_description = excluded.entity_description,
        username_rules = excluded.username_rules, profile_url_template = excluded.profile_url_template,
        registration_url = excluded.registration_url, availability_strategy = excluded.availability_strategy,
        availability_notes = excluded.availability_notes, derived_from = excluded.derived_from,
        creation_strategy = excluded.creation_strategy, manual_steps = excluded.manual_steps,
        rate_limit_policy = excluded.rate_limit_policy, required_credentials = excluded.required_credentials,
        updated_at = now()`;
  }
  return PLATFORM_CATALOG.length;
}
