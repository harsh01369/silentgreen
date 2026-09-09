/**
 * Required configuration, validated once at startup.
 *
 * A missing secret should stop the process with a clear message, not surface
 * later as a confusing auth or database error. Everything here is provided by
 * the deployment (Railway variables, or a local .env).
 */

import { z } from 'zod';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env in production; the platform injects the variables directly.
}

const schema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(16, 'BETTER_AUTH_SECRET must be a long random string'),
  BETTER_AUTH_URL: z.string().url().describe('the public URL of this API'),
  WEB_ORIGIN: z.string().url().describe('the web app origin, for CORS and cookies'),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const missing = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`\nConfiguration is incomplete:\n${missing}\n`);
  process.exit(1);
}

export const env = parsed.data;
