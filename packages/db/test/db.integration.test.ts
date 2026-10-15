import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { AvailabilityResult, StoredCandidate } from '@sha/core';
import { createDb, createPlatformCatalog, createUnitOfWork, createUserProvisioner, withWorkspace, schema, type DbHandle } from '../src';

const url = process.env.TEST_DATABASE_URL;

/** Drizzle wraps driver errors; the Postgres error is the `cause`. */
async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as { message?: string; cause?: { message?: string } };
    return err.cause?.message ?? err.message ?? String(e);
  }
  throw new Error('expected the database to reject the operation');
}

describe.skipIf(!url)('Postgres repositories + row-level security (TEST_DATABASE_URL)', () => {
  let h: DbHandle;
  beforeAll(() => { h = createDb(url!, { max: 4 }); });
  afterAll(async () => { await h?.close(); });

  const email = (tag: string) => `${tag}-${randomUUID().slice(0, 8)}@example.test`;
  const candidates: StoredCandidate[] = [{ handle: 'acme', kind: 'primary', relevance: 1, perPlatform: { x: { handle: 'acme', valid: false, issues: [] } } }];
  const result = (handle: string): AvailabilityResult => ({
    platform: 'reddit', handle, status: 'available', confidence: 'high', checkedAt: new Date().toISOString(), source: 'test', simulated: true, evidence: 'fixture',
  });

  it('connects as a non-superuser without BYPASSRLS', async () => {
    const [r] = await h.client`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
    expect(r).toMatchObject({ rolsuper: false, rolbypassrls: false });
  });

  it('provisions users idempotently and reads the platform catalog', async () => {
    const p = createUserProvisioner(h.db);
    const e = email('prov');
    const a = await p.provision(e);
    const b = await p.provision(e.toUpperCase());
    expect(b).toEqual(a);
    expect(a.role).toBe('owner');
    const platforms = await createPlatformCatalog(h.db).listEnabled();
    expect(platforms.map((x) => x.slug)).toEqual(['x', 'instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'pinterest', 'reddit', 'snapchat', 'threads']);
  });

  it('isolates every workspace table by RLS', async () => {
    const prov = createUserProvisioner(h.db);
    const uow = createUnitOfWork(h.db);
    const alice = await prov.provision(email('alice'));
    const bob = await prov.provision(email('bob'));

    const { checkId, jobId } = await uow.run(alice.workspaceId, async (r) => {
      const c = await r.checks.create({ createdBy: alice.userId, originalInput: 'Acme', requestedHandle: null, normalizedHandle: 'acme', providerMode: 'mock', platforms: ['reddit'], candidates });
      await r.checks.upsertResults(c.id, [result('acme')]);
      await r.observations.append([result('acme')]);
      const j = await r.jobs.create({ checkId: c.id, requestedBy: alice.userId, platform: 'reddit', handle: 'acme', email: 'a@example.test', providerMode: 'mock' });
      await r.audit.record({ actorUserId: alice.userId, action: 'test.event', entityType: 'check', entityId: c.id });
      return { checkId: c.id, jobId: j.id };
    });

    // Alice sees her data, including the job's audit trail.
    const own = await uow.run(alice.workspaceId, (r) => Promise.all([r.checks.get(checkId), r.jobs.get(jobId)]));
    expect(own[0]?.results).toHaveLength(1);
    expect(own[1]?.events.map((e) => e.toStatus)).toEqual(['queued']);

    // Bob sees nothing of Alice's, through repos or raw SQL.
    const bobView = await uow.run(bob.workspaceId, (r) => Promise.all([r.checks.get(checkId), r.jobs.get(jobId), r.jobs.list(50)]));
    expect(bobView[0]).toBeNull();
    expect(bobView[1]).toBeNull();
    expect(bobView[2]).toEqual([]);
    const counts = await withWorkspace(h.db, bob.workspaceId, (tx) =>
      tx.execute<{ n: number }>(sql`select
        (select count(*) from handle_check_results where handle_check_id = ${checkId})
        + (select count(*) from availability_observations where workspace_id = ${alice.workspaceId})
        + (select count(*) from audit_events where workspace_id = ${alice.workspaceId})
        + (select count(*) from users where id = ${alice.userId})
        + (select count(*) from workspaces where id = ${alice.workspaceId}) as n`),
    );
    expect(Number(counts[0]!.n)).toBe(0);

    // Without a workspace context, nothing is visible at all.
    const [none] = await h.client`select count(*)::int as n from handle_checks`;
    expect(none!.n).toBe(0);
  });

  it('rejects writes into another workspace (WITH CHECK)', async () => {
    const prov = createUserProvisioner(h.db);
    const alice = await prov.provision(email('alice2'));
    const bob = await prov.provision(email('bob2'));
    expect(await pgError(
      withWorkspace(h.db, bob.workspaceId, (tx) =>
        tx.insert(schema.auditEvents).values({ workspaceId: alice.workspaceId, action: 'forged', entityType: 'x' }),
      ),
    )).toMatch(/row-level security/);
  });

  it('cannot update or delete audit events (append-only grant)', async () => {
    const alice = await createUserProvisioner(h.db).provision(email('alice3'));
    expect(await pgError(withWorkspace(h.db, alice.workspaceId, (tx) => tx.update(schema.auditEvents).set({ action: 'tampered' })))).toMatch(/permission denied/);
    expect(await pgError(withWorkspace(h.db, alice.workspaceId, (tx) => tx.delete(schema.auditEvents)))).toMatch(/permission denied/);
  });

  it('isolates platform_credentials by workspace', async () => {
    const prov = createUserProvisioner(h.db);
    const alice = await prov.provision(email('alice5'));
    const bob = await prov.provision(email('bob5'));
    const blob = Buffer.from('x');
    await withWorkspace(h.db, alice.workspaceId, (tx) =>
      tx.insert(schema.platformCredentials).values({ workspaceId: alice.workspaceId, platform: 'reddit', label: 'oauth', ciphertext: blob, iv: blob, authTag: blob, wrappedDek: blob, keyVersion: 1, createdBy: alice.userId }),
    );
    const own = await withWorkspace(h.db, alice.workspaceId, (tx) => tx.select().from(schema.platformCredentials));
    const other = await withWorkspace(h.db, bob.workspaceId, (tx) => tx.select().from(schema.platformCredentials));
    expect(own).toHaveLength(1);
    expect(other).toHaveLength(0);
  });

  it('rejects references to another workspace even when RLS would allow the row (composite FKs)', async () => {
    const prov = createUserProvisioner(h.db);
    const alice = await prov.provision(email('alice6'));
    const bob = await prov.provision(email('bob6'));
    const uow = createUnitOfWork(h.db);
    const aliceCheck = await uow.run(alice.workspaceId, (r) =>
      r.checks.create({ createdBy: alice.userId, originalInput: 'Acme', requestedHandle: null, normalizedHandle: 'acme', providerMode: 'mock', platforms: ['reddit'], candidates }),
    );
    // Bob's workspace context, but pointing at Alice's check: RLS passes, the FK must not.
    expect(
      await pgError(uow.run(bob.workspaceId, (r) => r.jobs.create({ checkId: aliceCheck.id, requestedBy: bob.userId, platform: 'reddit', handle: 'acme', email: 'b@example.test', providerMode: 'mock' }))),
    ).toMatch(/violates foreign key constraint/);
  });

  it('enforces one active job per platform+handle and optimistic status updates', async () => {
    const alice = await createUserProvisioner(h.db).provision(email('alice4'));
    const uow = createUnitOfWork(h.db);
    const job = await uow.run(alice.workspaceId, async (r) => {
      const c = await r.checks.create({ createdBy: alice.userId, originalInput: 'Acme', requestedHandle: null, normalizedHandle: 'acme', providerMode: 'mock', platforms: ['reddit'], candidates });
      return r.jobs.create({ checkId: c.id, requestedBy: alice.userId, platform: 'reddit', handle: 'acme', email: 'a@example.test', providerMode: 'mock' });
    });
    // A concurrent duplicate surfaces as a typed 409 conflict, not a raw 500.
    await expect(
      uow.run(alice.workspaceId, (r) => r.jobs.create({ checkId: job.checkId, requestedBy: alice.userId, platform: 'reddit', handle: 'acme', email: 'a@example.test', providerMode: 'mock' })),
    ).rejects.toMatchObject({ code: 'conflict', status: 409 });
    const moved = await uow.run(alice.workspaceId, (r) => r.jobs.update(job.id, 'queued', { status: 'running', attempts: 1 }, { message: 'start', actorUserId: null }));
    expect(moved?.status).toBe('running');
    const stale = await uow.run(alice.workspaceId, (r) => r.jobs.update(job.id, 'queued', { status: 'cancelled' }, { message: 'late', actorUserId: null }));
    expect(stale).toBeNull();
    // Generation guard: a writer holding an old generation cannot update.
    const wrongGen = await uow.run(alice.workspaceId, (r) => r.jobs.update(job.id, 'running', { status: 'failed' }, { message: 'stale worker', actorUserId: null }, job.generation + 1));
    expect(wrongGen).toBeNull();
  });
});
