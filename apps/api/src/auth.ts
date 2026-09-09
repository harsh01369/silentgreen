/**
 * Better Auth, backed by Neon through Drizzle.
 *
 * Identity lives in our own database, not a vendor's cloud. A product that tells
 * agencies their evidence stays theirs cannot itself ship user records to a
 * third party.
 *
 * Plugins:
 *   organization  orgs, members, roles, invitations. An org is the billing and
 *                 ownership unit; projects belong to an org.
 *   apiKey        org-scoped keys for the ingest API, with rate limiting and
 *                 expiry. This is how a pipeline talks to the service.
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins';
import { apiKey } from '@better-auth/api-key';
import { db, schema } from './db/index.js';
import { env } from './env.js';

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.WEB_ORIGIN],
  database: drizzleAdapter(db, { provider: 'pg', schema }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },

  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      organizationLimit: 5,
      creatorRole: 'owner',
      membershipLimit: 100,
      invitationExpiresIn: 60 * 60 * 48,
    }),
    apiKey({
      defaultPrefix: 'sg_',
      // A key is an ingest credential, not a login. Keep the surface small.
      enableMetadata: true,
      rateLimit: {
        enabled: true,
        timeWindow: 1000 * 60,
        maxRequests: 120,
      },
    }),
  ],
});

export type Auth = typeof auth;
