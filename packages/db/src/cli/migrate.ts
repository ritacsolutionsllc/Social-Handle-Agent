import postgres from 'postgres';
import { runMigrations } from '../migrate';
import { guardProduction, loadDotEnv, requireEnv } from './env';

loadDotEnv();
guardProduction('run migrations');
const urlVar = process.argv.includes('--test') ? 'TEST_MIGRATION_DATABASE_URL' : 'MIGRATION_DATABASE_URL';
const sql = postgres(requireEnv(urlVar), { max: 1, onnotice: () => {} });
try {
  const applied = await runMigrations(sql);
  console.log(applied.length ? `${applied.length} migration(s) applied` : 'database is up to date');
} finally {
  await sql.end();
}
