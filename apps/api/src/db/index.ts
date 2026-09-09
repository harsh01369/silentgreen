import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import { env } from '../env.js';

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  // Neon requires TLS; it terminates at the pooler so no CA pinning here.
  ssl: env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 10,
});

export const db = drizzle(pool, { schema });
export { schema };
