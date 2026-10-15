import postgres from 'postgres';
import { seedPlatforms } from '../migrate';
import { guardProduction, loadDotEnv, requireEnv } from './env';

loadDotEnv();
guardProduction('seed the platform catalog');
const urlVar = process.argv.includes('--test') ? 'TEST_MIGRATION_DATABASE_URL' : 'MIGRATION_DATABASE_URL';
const sql = postgres(requireEnv(urlVar), { max: 1, onnotice: () => {} });
try {
  console.log(`seeded ${await seedPlatforms(sql)} platforms`);
} finally {
  await sql.end();
}
