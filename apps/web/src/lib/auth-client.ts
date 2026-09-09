'use client';

import { createAuthClient } from 'better-auth/react';
import { organizationClient } from 'better-auth/client/plugins';
import { apiKeyClient } from '@better-auth/api-key/client';

/**
 * The API owns auth. In development, next.config rewrites /api/auth to it so
 * cookies stay same-origin; in production the web and API share a parent domain.
 */
export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [organizationClient(), apiKeyClient()],
});

export const { useSession, signIn, signOut, signUp, organization } = authClient;
