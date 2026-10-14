import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface DbHandle {
  db: Db;
  client: postgres.Sql;
  close(): Promise<void>;
}

export function createDb(url: string, opts: { max?: number } = {}): DbHandle {
  const client = postgres(url, {
    max: opts.max ?? 10,
    idle_timeout: 30,
    connect_timeout: 10,
    // Statement timeout protects the pool from runaway queries.
    connection: { statement_timeout: 15_000, application_name: 'social-handle-agent' },
    onnotice: () => {},
  });
  return { db: drizzle(client, { schema }), client, close: () => client.end({ timeout: 5 }) };
}

/**
 * Run `fn` in a transaction where RLS sees only `workspaceId`.
 * set_config(..., true) is transaction-local, so pooled connections never leak scope.
 */
export async function withWorkspace<T>(db: Db, workspaceId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
    return fn(tx);
  });
}
