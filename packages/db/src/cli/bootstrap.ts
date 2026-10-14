import postgres from 'postgres';
import { guardProduction, loadDotEnv, requireEnv } from './env';

/**
 * One-time local/infra setup (needs a role with CREATEROLE/CREATEDB):
 *  - NOLOGIN group role `sha_app` (privileges are granted by migrations)
 *  - LOGIN role from DATABASE_URL, member of sha_app, password APP_DB_PASSWORD
 *  - databases named in DATABASE_URL and TEST_DATABASE_URL
 */
loadDotEnv();
guardProduction('bootstrap roles and databases');

const admin = postgres(requireEnv('ADMIN_DATABASE_URL'), { max: 1, onnotice: () => {} });
const appUrl = new URL(requireEnv('DATABASE_URL'));
const appUser = decodeURIComponent(appUrl.username);
const appPassword = requireEnv('APP_DB_PASSWORD');
const ident = /^[a-z_][a-z0-9_]{0,62}$/;
if (!ident.test(appUser)) throw new Error('DATABASE_URL username must be a simple lowercase identifier');
if (!/^[A-Za-z0-9._~-]{12,128}$/.test(appPassword)) throw new Error('APP_DB_PASSWORD must be 12-128 URL-safe characters');

const dbNames = [appUrl, process.env.TEST_DATABASE_URL ? new URL(process.env.TEST_DATABASE_URL) : null]
  .filter((u): u is URL => u !== null)
  .map((u) => u.pathname.slice(1));

try {
  const roles = new Set((await admin<{ rolname: string }[]>`select rolname from pg_roles`).map((r) => r.rolname));
  if (!roles.has('sha_app')) await admin.unsafe('create role sha_app nologin');
  if (!roles.has(appUser)) await admin.unsafe(`create role ${appUser} login in role sha_app`);
  await admin.unsafe(`alter role ${appUser} with login nosuperuser nocreatedb nocreaterole nobypassrls password '${appPassword}'`);
  await admin.unsafe(`grant sha_app to ${appUser}`);
  for (const name of dbNames) {
    if (!ident.test(name)) throw new Error(`database name "${name}" must be a simple identifier`);
    const [exists] = await admin`select 1 from pg_database where datname = ${name}`;
    if (!exists) {
      await admin.unsafe(`create database ${name}`);
      console.log(`created database ${name}`);
    }
  }
  console.log(`bootstrap complete (app role: ${appUser} ∈ sha_app)`);
} finally {
  await admin.end();
}
