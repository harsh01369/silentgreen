/**
 * Apply pending migrations, then exit. Run on deploy, before the server starts.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { env } from '../env.js';

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 1,
});

await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
await pool.end();
console.log('migrations applied');
